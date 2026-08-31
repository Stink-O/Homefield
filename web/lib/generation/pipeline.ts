// Shared generation job body.
//
// Extracted from app/api/generate/route.ts so the browser path and the agent
// path run identical logic: same credential resolution, same concurrency
// semaphore, same retry policy, same disk/DB writes and the same SSE
// broadcasts — which is why an agent generation shows up live in open tabs.
//
// Permission checks are the caller's job. By the time this runs, the workspace
// has been validated, scopes and spend ceilings have been enforced, and the job
// has been registered.

import { ServiceAccount } from "@/lib/vertexAuth";
import { db } from "@/lib/db";
import { images } from "@/lib/db/schema";
import { saveImageFile, saveReferenceImages, deleteImageFile, deleteReferenceImages } from "@/lib/fileStorage";
import { resolveJob, failJob, unregisterJobAbort } from "@/lib/jobs";
import { broadcastShared, broadcastSharedPendingEnd } from "@/lib/sharedBroadcast";
import { broadcastImage, broadcastPendingEnd, broadcastPendingProcessing } from "@/lib/imageBroadcast";
import { clearSharedPending } from "@/lib/sharedPending";
import { callReplicate } from "@/lib/replicate";
import { acquireVertexSlot, drainVertexQueue, callGemini, callImagen } from "./vertex";
import type { AgentProvenance } from "@/lib/agent/contract";

export interface GenerationJobParams {
  jobId: string;
  imageId: string;
  userId: string;
  username: string;
  prompt: string;
  /** Already normalised to a GA model id. */
  model: string;
  /**
   * Null when the caller did not specify one. Two different defaults apply and
   * they are not interchangeable: the model call falls back to "Auto" (which
   * Gemini reads as "you decide" and Imagen as "omit the parameter"), while the
   * stored row and the broadcasts fall back to "1:1", the concrete ratio the
   * gallery lays out against. Collapsing them records "Auto" as if it were a
   * real aspect ratio.
   */
  aspectRatio: string | null;
  selectedAspectRatio: string;
  quality?: string;
  searchGrounding?: boolean;
  /** Already ownership-checked. Null means the user's Main workspace. */
  workspaceId: string | null;
  referenceImages?: { base64: string; mimeType: string }[];
  isShared: boolean;
  /** Resolved for this user; null means generation is unavailable. */
  sa: ServiceAccount | null;
  /** Present only for agent-initiated generations. */
  provenance?: AgentProvenance;
  cancelSignal: AbortSignal;
}

/**
 * Runs one generation to completion, writing the image to disk and the database
 * and resolving the job. Never throws: failures are recorded on the job and
 * broadcast as a pending-end so clients drop their shimmer.
 */
export async function runGenerationJob(params: GenerationJobParams): Promise<void> {
  const {
    jobId, imageId, userId, username, prompt, model: selectedModel,
    aspectRatio: requestedAspectRatio, selectedAspectRatio, quality, searchGrounding,
    workspaceId, referenceImages: validatedRefImages, isShared, sa,
    provenance, cancelSignal,
  } = params;

  // See the note on GenerationJobParams.aspectRatio.
  const apiAspectRatio = requestedAspectRatio ?? "Auto";
  const aspectRatio = requestedAspectRatio ?? "1:1";

  try {
      const isGemini = selectedModel.startsWith("gemini");

      // Server-side diagnostic: log reference image count and sizes so retry issues are
      // immediately visible in the terminal (images must be re-sent every call).
      console.log(
        `[HomeField] ${jobId.slice(0, 8)} → ${selectedModel} | ` +
        `${validatedRefImages && validatedRefImages.length > 0
          ? `${validatedRefImages.length} ref image(s): ${validatedRefImages.map((img) => `${img.mimeType} ${Math.round(img.base64.length / 1024)}KB`).join(", ")}`
          : "no ref images"}`
      );

      let result: { base64: string; mimeType: string; grounded?: boolean };
      const useReplicate = process.env.GENERATION_PROVIDER === "replicate" && isGemini;

      if (useReplicate) {
        try {
          result = await callReplicate(
            selectedModel,
            prompt as string,
            apiAspectRatio,
            validatedRefImages,
            quality as string | undefined,
            searchGrounding as boolean | undefined,
            cancelSignal,
            () => broadcastPendingProcessing(userId, jobId)
          );
        } catch (replicateErr) {
          if (cancelSignal.aborted) throw replicateErr;
          // Replicate failed — fall back to Vertex AI if credentials are available.
          if (!sa) throw replicateErr;
          console.warn(`[HomeField] ${jobId.slice(0, 8)} Replicate failed, falling back to Vertex AI:`, replicateErr instanceof Error ? replicateErr.message : replicateErr);
          const releaseSlot = await acquireVertexSlot();
          try {
            result = await callGemini(sa, selectedModel, prompt as string, apiAspectRatio, validatedRefImages, quality as string | undefined, searchGrounding as boolean | undefined, cancelSignal);
          } finally {
            releaseSlot();
          }
        }
      } else {
        if (!sa) throw new Error("Server credentials not configured");
        // Acquire a concurrency slot before hitting Vertex AI.
        // Releases as soon as the network call finishes so the next queued job
        // can start immediately while we write to disk and DB.
        const releaseSlot = await acquireVertexSlot();
        try {
          result = isGemini
            ? await callGemini(sa, selectedModel, prompt as string, apiAspectRatio, validatedRefImages, quality as string | undefined, searchGrounding as boolean | undefined, cancelSignal)
            // Imagen takes the concrete ratio, not "Auto" — vertex.ts omits the
            // parameter entirely for "Auto", which is right for Gemini and wrong here.
            : await callImagen(sa, selectedModel, prompt as string, aspectRatio, cancelSignal);
        } finally {
          releaseSlot();
        }
      }

      // Save image to disk and generate thumbnail
      const ownerId = isShared ? "shared" : userId;
      const { filePath, thumbnailPath, width, height } = await saveImageFile(ownerId, imageId, result.base64, result.mimeType);
      const refPaths = validatedRefImages && validatedRefImages.length > 0
        ? await saveReferenceImages(ownerId, imageId, validatedRefImages)
        : [];
      const thumbnailUrl = `/api/files/${thumbnailPath}`;
      const timestamp = Date.now();

      // workspaceId ownership was validated in the synchronous handler before generation started.
      const resolvedWorkspaceId: string | null = (!isShared && typeof workspaceId === "string") ? workspaceId : null;

      // Persist to database — if this fails, clean up saved files to prevent orphans on disk
      try {
        await db.insert(images).values({
          id: imageId,
          userId,
          workspaceId: isShared ? null : resolvedWorkspaceId,
          prompt,
          model: selectedModel,
          aspectRatio,
          selectedAspectRatio: selectedAspectRatio ?? requestedAspectRatio ?? "Auto",
          quality: quality ?? null,
          width,
          height,
          filePath,
          thumbnailPath,
          mimeType: result.mimeType,
          timestamp,
          isShared: isShared ?? false,
          searchGrounding: result.grounded ?? false,
          referenceImagePaths: refPaths.length > 0 ? JSON.stringify(refPaths) : null,
          ...(provenance ?? {}),
        });
      } catch (dbErr) {
        await deleteImageFile(filePath, thumbnailPath).catch(() => {});
        if (refPaths.length > 0) await deleteReferenceImages(ownerId, imageId).catch(() => {});
        throw dbErr;
      }

      // Broadcast to shared gallery subscribers if this is a shared generation
      if (isShared) {
        broadcastShared({
          id: imageId,
          jobId,
          userId,
          username,
          prompt,
          model: selectedModel,
          aspectRatio,
          quality: quality ?? null,
          width,
          height,
          thumbnailUrl,
          timestamp,
          referenceImageDataUrls: refPaths.length > 0 ? refPaths.map((p) => `/api/files/${p}`) : undefined,
        });
      }

      resolveJob(jobId, { imageId, thumbnailUrl, width, height, mimeType: result.mimeType, grounded: result.grounded, referenceImagePaths: refPaths.length > 0 ? refPaths : undefined });

      // Broadcast to all devices logged in as this user so they update in real-time.
      if (!isShared) {
        broadcastImage(userId, {
          id: imageId,
          jobId,
          userId,
          workspaceId: resolvedWorkspaceId,
          prompt,
          model: selectedModel,
          aspectRatio,
          selectedAspectRatio: selectedAspectRatio ?? requestedAspectRatio ?? "Auto",
          quality: quality ?? null,
          width,
          height,
          thumbnailUrl,
          mimeType: result.mimeType,
          timestamp,
          searchGrounding: result.grounded ?? false,
          referenceImageDataUrls: refPaths.length > 0 ? refPaths.map((p) => `/api/files/${p}`) : undefined,
          origin: provenance ? "agent" : "user",
          agentKeyId: provenance?.agentKeyId ?? null,
          agentLabel: provenance?.agentLabel ?? null,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      console.error(`[HomeField] ${jobId.slice(0, 8)} FAILED:`, message);
      // Quota exhaustion won't recover — immediately fail all queued jobs
      // rather than making each one wait and retry for nothing.
      if (message.startsWith("Quota exhausted")) {
        drainVertexQueue(new Error(message));
      }
      failJob(jobId, message);
      // Tell all devices to remove the pending shimmer for this job.
      if (!isShared) broadcastPendingEnd(userId, jobId);
      else broadcastSharedPendingEnd(jobId);
    } finally {
      unregisterJobAbort(jobId);
      clearSharedPending(jobId);
    }
}
