"use client";

import { useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useApp } from "@/contexts/AppContext";
import { resumeJob } from "@/lib/gemini";
import { getPendingJobs, removePendingJob, addFailedJob } from "@/lib/pendingJobs";
import type { GeneratedImageMeta, AttachedImage, ModelId, Quality } from "@/lib/types";

// Local pending-generation card state for the private gallery page.
export interface PendingGeneration {
  id: string;
  jobId?: string;
  prompt: string;
  aspectRatio: string;
  selectedAspectRatio?: string;
  count: number;
  workspaceId: string;
  startedAt: number;
  model: ModelId;
  quality: Quality;
  images?: AttachedImage[];
  searchGrounding?: boolean;
  failed?: boolean;
  errorMessage?: string;
}

// On mount, resume polling for any jobs that survived a page refresh/app backgrounding.
// The ref guard prevents React StrictMode's double-invocation from adding duplicate cards.
export function useOrphanRecovery(
  setPending: Dispatch<SetStateAction<PendingGeneration[]>>,
  abortControllersRef: MutableRefObject<Map<string, AbortController>>,
  pushErrorToast: (message: string) => void,
) {
  const { dispatch } = useApp();
  const orphanRecoveryRanRef = useRef(false);

  useEffect(() => {
    if (orphanRecoveryRanRef.current) return;
    orphanRecoveryRanRef.current = true;

    const orphans = getPendingJobs();
    if (!orphans.length) return;

    for (const job of orphans) {
      const pendingId = job.jobId;

      (async () => {
        // Pre-check status before showing any UI so we never flash a shimmer or
        // error card for jobs that have already finished or been lost.
        let stillPending = false;
        try {
          const res = await fetch(`/api/generate/${pendingId}`, { cache: "no-store" });
          if (res.status === 404) {
            // Server no longer knows this job (restarted, or job expired) — drop it silently.
            removePendingJob(pendingId);
            return;
          }
          if (res.ok) {
            const jobData = await res.json();
            if (jobData.status === "done") {
              // Already complete — persist to history without showing a card.
              removePendingJob(pendingId);
              const meta: GeneratedImageMeta = {
                id: jobData.imageId,
                prompt: job.prompt,
                model: job.model,
                aspectRatio: job.aspectRatio,
                mimeType: jobData.mimeType ?? "image/png",
                width: jobData.width,
                height: jobData.height,
                timestamp: Date.now(),
                quality: job.quality,
                thumbnailUrl: jobData.thumbnailUrl,
                workspaceId: job.workspaceId || "main",
              };
              dispatch({ type: "ADD_IMAGE", payload: meta });
              return;
            }
            if (jobData.status === "error") {
              removePendingJob(pendingId);
              const errorMessage = (jobData.error as string | undefined) ?? "Generation failed";
              addFailedJob({
                id: pendingId,
                prompt: job.prompt,
                model: job.model,
                aspectRatio: job.aspectRatio,
                quality: job.quality,
                workspaceId: job.workspaceId || "main",
                searchGrounding: job.searchGrounding,
                images: job.images,
                errorMessage,
                failedAt: Date.now(),
              });
              setPending((prev) => [
                {
                  id: pendingId,
                  prompt: job.prompt,
                  aspectRatio: job.aspectRatio,
                  count: 1,
                  workspaceId: job.workspaceId || "main",
                  startedAt: job.startedAt,
                  model: job.model,
                  quality: job.quality,
                  searchGrounding: job.searchGrounding,
                  images: job.images,
                  failed: true,
                  errorMessage,
                },
                ...prev,
              ]);
              pushErrorToast(errorMessage);
              return;
            }
            // status === "pending" — job is genuinely still running.
            stillPending = true;
          }
        } catch {
          // Network error on pre-check — assume still pending and show the shimmer.
          stillPending = true;
        }

        if (!stillPending) return;

        // Job is in-progress — show the shimmer card and wait for completion.
        const controller = new AbortController();
        abortControllersRef.current.set(pendingId, controller);
        setPending((prev) => [
          {
            id: pendingId,
            prompt: job.prompt,
            aspectRatio: job.aspectRatio,
            count: 1,
            workspaceId: job.workspaceId || "main",
            startedAt: job.startedAt,
            model: job.model,
            quality: job.quality,
            searchGrounding: job.searchGrounding,
          },
          ...prev,
        ]);

        try {
          const data = await resumeJob(pendingId, controller.signal);
          removePendingJob(pendingId);
          const meta: GeneratedImageMeta = {
            id: data.imageId,
            prompt: job.prompt,
            model: job.model,
            aspectRatio: job.aspectRatio,
            mimeType: data.mimeType,
            width: data.width,
            height: data.height,
            timestamp: Date.now(),
            quality: job.quality,
            thumbnailUrl: data.thumbnailUrl,
            workspaceId: job.workspaceId || "main",
            referenceImageDataUrls: data.referenceImageDataUrls,
          };
          dispatch({ type: "ADD_IMAGE", payload: meta });
          setPending((prev) => prev.filter((p) => p.id !== pendingId));
          abortControllersRef.current.delete(pendingId);
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return;
          const errorMessage = err instanceof Error ? err.message : "Generation failed";
          addFailedJob({
            id: pendingId,
            prompt: job.prompt,
            model: job.model,
            aspectRatio: job.aspectRatio,
            quality: job.quality,
            workspaceId: job.workspaceId || "main",
            searchGrounding: job.searchGrounding,
            images: job.images,
            errorMessage,
            failedAt: Date.now(),
          });
          setPending((prev) => prev.map((p) => p.id === pendingId ? { ...p, images: job.images, failed: true, errorMessage } : p));
          abortControllersRef.current.delete(pendingId);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
