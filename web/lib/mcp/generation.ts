// generate_image, get_generation_status, cancel_generation.
//
// generate_image deliberately has no `shared` parameter. In the REST route that
// flag writes the row outside every workspace, forces workspaceId to null and
// broadcasts the result to every account on the instance — one boolean that
// escapes the entire destination model. An agent cannot ask for it here.
//
// There is also no separate edit_image tool: editing an existing picture is
// generate_image with reference_image_ids pointing at it.

import { z } from "zod";
import { downloadUrlFor } from "@/lib/agent/downloadToken";
import type { McpServer } from "@modelcontextprotocol/server";
import { abortJob, failJob, getJobForUser } from "@/lib/jobs";
import { clearSharedPending } from "@/lib/sharedPending";
import { checkRateLimit } from "@/lib/rateLimit";
import { NoCredentialsError, startAgentGeneration } from "@/lib/generation/agentRun";
import {
  QUALITY_RANK,
  modelWithinLimit,
  qualityWithinLimit,
  type AgentPrincipal,
} from "@/lib/agent/contract";
import { incrementDailyUsage } from "@/lib/agent/keys";
import { MODEL_QUALITIES, type AspectRatio, type ModelId, type Quality } from "@/lib/types";
import {
  AgentToolError,
  describeDestination,
  imageResourceUri,
  imageSummary,
  requireAccessibleImage,
  requireScope,
  resolveWorkspaceTarget,
  runTool,
  toolJson,
  toolText,
} from "@/lib/mcp/context";
import {
  MAX_REFERENCE_IMAGES,
  aspectRatioSchema,
  imageIdSchema,
  modelSchema,
  promptSchema,
  qualitySchema,
  qualitySupportMessage,
  qualitySupportedByModel,
  referenceUploadSchema,
  workspaceIdSchema,
} from "@/lib/mcp/schemas";
import { readAsReference, renderPreview } from "@/lib/mcp/preview";
import { forgetAgentJob, lookupAgentJob, rememberAgentJob } from "@/lib/mcp/jobRegistry";

const FALLBACK_MODEL: ModelId = "gemini-3.1-flash-image";
const FALLBACK_QUALITY: Quality = "1K";

// Mirrors the per-user ceiling on the REST generation route, keyed per API key
// so one busy agent cannot exhaust its owner's Vertex quota in a burst.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 10 * 60 * 1000;

/** Honours the key's model ceiling when the agent does not name a model. */
function defaultModel(principal: AgentPrincipal): ModelId {
  const ceiling = principal.limits.maxModel;
  if (ceiling && !modelWithinLimit(FALLBACK_MODEL, ceiling)) return ceiling;
  return FALLBACK_MODEL;
}

/**
 * Honours both the key's quality ceiling and what the model actually supports.
 * The two can be mutually exclusive — a key capped at "512" paired with Pro,
 * which has no 512 tier — in which case there is no legal default and the call
 * is refused rather than quietly upgraded.
 */
function defaultQuality(principal: AgentPrincipal, model: ModelId): Quality {
  const allowed = MODEL_QUALITIES[model].filter((q) => qualityWithinLimit(q, principal.limits.maxQuality));
  if (allowed.length === 0) {
    throw new AgentToolError(
      "quality_exceeds_limit",
      `Model "${model}" supports ${MODEL_QUALITIES[model].join(", ")}, all of which are above this API key's "${principal.limits.maxQuality}" ceiling. Choose a different model.`,
    );
  }
  if (allowed.includes(FALLBACK_QUALITY)) return FALLBACK_QUALITY;
  return allowed.reduce((best, q) => (QUALITY_RANK[q] > QUALITY_RANK[best] ? q : best), allowed[0]);
}

export function registerGenerationTools(server: McpServer, principal: AgentPrincipal, origin: string): void {
  server.registerTool(
    "generate_image",
    {
      title: "Generate an image",
      description:
        "Generates an image from a text prompt and returns a job handle. Generation is asynchronous — poll get_generation_status with the returned job_id. " +
        "To edit or restyle an existing picture, pass its id in reference_image_ids; there is no separate edit tool. " +
        describeDestination(principal),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        prompt: promptSchema,
        model: modelSchema.optional(),
        quality: qualitySchema.optional(),
        aspect_ratio: aspectRatioSchema.optional(),
        search_grounding: z
          .boolean()
          .optional()
          .describe("Let the model ground the prompt with a web search. Slower; useful for real places, people or events."),
        workspace_id: workspaceIdSchema.optional(),
        reference_image_ids: z
          .array(imageIdSchema)
          .max(MAX_REFERENCE_IMAGES)
          .optional()
          .describe(
            `Ids of images already in the owner's library to use as references — this is how you edit, restyle or extend an existing image. At most ${MAX_REFERENCE_IMAGES} references in total.`,
          ),
        reference_images: z
          .array(referenceUploadSchema)
          .max(MAX_REFERENCE_IMAGES)
          .optional()
          .describe(`Raw images to upload as references. Counts towards the same limit of ${MAX_REFERENCE_IMAGES}.`),
      }),
    },
    async (args) =>
      runTool(async () => {
        requireScope(principal, "generate");

        const now = Date.now();
        const limit = principal.limits.dailyImageLimit;

        const rl = checkRateLimit(`agent-generate:${principal.keyId}`, RATE_LIMIT, RATE_WINDOW_MS);
        if (!rl.allowed) {
          throw new AgentToolError(
            "daily_limit_reached",
            `Rate limit reached (${RATE_LIMIT} generations per ${RATE_WINDOW_MS / 60000} minutes). Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
          );
        }

        const model: ModelId = args.model ?? defaultModel(principal);
        const quality: Quality = args.quality ?? defaultQuality(principal, model);
        const aspectRatio: AspectRatio = args.aspect_ratio ?? "Auto";

        if (!modelWithinLimit(model, principal.limits.maxModel)) {
          throw new AgentToolError(
            "model_exceeds_limit",
            `This API key is capped at model "${principal.limits.maxModel}" and cannot use "${model}".`,
          );
        }
        if (!qualityWithinLimit(quality, principal.limits.maxQuality)) {
          throw new AgentToolError(
            "quality_exceeds_limit",
            `This API key is capped at quality "${principal.limits.maxQuality}" and cannot request "${quality}".`,
          );
        }
        if (!qualitySupportedByModel(model, quality)) {
          throw new AgentToolError("invalid_input", qualitySupportMessage(model, quality));
        }

        const workspaceId = await resolveWorkspaceTarget(principal, args.workspace_id);

        const referenceImages = await collectReferences(principal, args.reference_image_ids, args.reference_images);

        // Reserve the image against the daily budget BEFORE starting work.
        //
        // principal.usedToday is read once at authentication, so checking it
        // here would let N concurrent calls all see the same pre-flight value
        // and all pass — a key capped at 5 could burn the whole rate-limit
        // window. incrementDailyUsage is an atomic SQL increment, so making it
        // the gate is what actually serialises the decision. Over-refusing at
        // the boundary is the safe direction for a spend limit.
        const usedToday = await incrementDailyUsage(principal.keyId, now);
        if (limit !== null && usedToday > limit) {
          await incrementDailyUsage(principal.keyId, now, -1);
          throw new AgentToolError(
            "daily_limit_reached",
            `This API key has already generated its daily allowance of ${limit} image(s). The counter resets at 00:00 UTC.`,
          );
        }

        let handle;
        try {
          handle = await startAgentGeneration({
            principal,
            prompt: args.prompt,
            model,
            aspectRatio,
            quality,
            searchGrounding: args.search_grounding,
            workspaceId,
            referenceImages,
          });
        } catch (err) {
          // The one thing the pipeline throws for rather than failing the job:
          // an account with no usable Google credentials. The contract has a
          // reason for exactly this, so report it instead of a generic failure.
          // Nothing was generated, so release the reservation rather than
          // charging the budget for a job that never started.
          await incrementDailyUsage(principal.keyId, now, -1).catch(() => {});
          if (err instanceof NoCredentialsError) {
            throw new AgentToolError("no_credentials", err.message);
          }
          throw err;
        }

        rememberAgentJob(handle.jobId, {
          keyId: principal.keyId,
          userId: principal.userId,
          imageId: handle.imageId,
          startedAt: now,
        });

        return toolJson(
          {
            job_id: handle.jobId,
            image_id: handle.imageId,
            status: "pending",
            model,
            quality,
            aspect_ratio: aspectRatio,
            workspace_id: workspaceId ?? "main",
            reference_count: referenceImages.length,
            used_today: usedToday,
            daily_limit: limit,
          },
          "Generation started. Poll get_generation_status with job_id until status is \"done\" or \"error\".",
        );
      }),
  );

  server.registerTool(
    "get_generation_status",
    {
      title: "Check a generation",
      description:
        "Reports on a generation started by this API key. When it has finished, returns the image metadata, a small inline preview and a resource link to the full-resolution file. Jobs started by other keys or by the browser UI are not visible.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({
        job_id: z.string().min(1).describe("The job_id returned by generate_image."),
      }),
    },
    async (args) =>
      runTool(async () => {
        const owner = lookupAgentJob(args.job_id, principal.keyId, principal.userId);
        if (!owner) {
          throw new AgentToolError("not_found", `Job ${args.job_id} was not started by this API key, or has expired.`);
        }

        const job = getJobForUser(args.job_id, principal.userId);
        if (!job) {
          return toolJson({ job_id: args.job_id, status: "expired" }, "The job record has expired from the server's memory.");
        }
        if (job.status === "pending") {
          return toolJson({ job_id: args.job_id, status: "pending" }, "Still generating. Poll again shortly.");
        }
        if (job.status === "error") {
          return toolJson({ job_id: args.job_id, status: "error", error: job.error ?? "Generation failed" });
        }

        // Re-check the finished image through the same guard every other
        // id-addressed tool uses. A job handle must not become a way to read an
        // image the key could not otherwise reach.
        const imageId = job.imageId ?? owner.imageId;
        const row = await requireAccessibleImage(principal, imageId).catch(() => null);
        if (!row) {
          throw new AgentToolError("not_found", `The generated image ${imageId} is no longer available.`);
        }

        const preview = await renderPreview(row.thumbnailPath ?? row.filePath);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({
              job_id: args.job_id,
              status: "done",
              image: { ...imageSummary(row), download_url: downloadUrlFor(origin, row.id, principal.keyId) },
            }, null, 2) },
            ...(preview ? [{ type: "image" as const, data: preview.base64, mimeType: preview.mimeType }] : []),
            {
              type: "resource_link" as const,
              uri: imageResourceUri(row.id),
              name: `image-${row.id}`,
              mimeType: row.mimeType,
              description: "Full-resolution image. Read this resource only when you need the original pixels.",
            },
          ],
        };
      }),
  );

  server.registerTool(
    "cancel_generation",
    {
      title: "Cancel a generation",
      description: "Aborts an in-flight generation started by this API key. Already-finished jobs are unaffected.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        job_id: z.string().min(1).describe("The job_id returned by generate_image."),
      }),
    },
    async (args) =>
      runTool(async () => {
        const owner = lookupAgentJob(args.job_id, principal.keyId, principal.userId);
        if (!owner) {
          throw new AgentToolError("not_found", `Job ${args.job_id} was not started by this API key, or has expired.`);
        }
        abortJob(args.job_id);
        failJob(args.job_id, "Cancelled");
        clearSharedPending(args.job_id);
        forgetAgentJob(args.job_id);
        return toolText(`Cancelled job ${args.job_id}.`);
      }),
  );
}

/**
 * Turns the two reference inputs into decoded, downsampled inline images.
 * Library ids are ownership-checked through the same guard every other read
 * uses, so a key cannot borrow an image it is not allowed to see.
 */
async function collectReferences(
  principal: AgentPrincipal,
  ids: string[] | undefined,
  uploads: { base64: string; mime_type: string }[] | undefined,
): Promise<{ base64: string; mimeType: string }[]> {
  const total = (ids?.length ?? 0) + (uploads?.length ?? 0);
  if (total > MAX_REFERENCE_IMAGES) {
    throw new AgentToolError(
      "invalid_input",
      `At most ${MAX_REFERENCE_IMAGES} reference images in total; received ${total}.`,
    );
  }

  const out: { base64: string; mimeType: string }[] = [];
  for (const id of ids ?? []) {
    const row = await requireAccessibleImage(principal, id);
    out.push(await readAsReference(row.filePath));
  }
  for (const upload of uploads ?? []) {
    out.push({ base64: upload.base64, mimeType: upload.mime_type });
  }
  return out;
}
