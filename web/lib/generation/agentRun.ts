// Generation entry point for agent callers.
//
// The MCP tool layer calls this instead of re-implementing generation. It runs
// the same lib/generation/pipeline used by the browser route, so agent output
// shares the concurrency semaphore, the retry policy, the disk and database
// writes, and the SSE broadcasts — which is why an agent generation appears
// live in an already-open tab, badged, without a refresh.
//
// Contract: this validates nothing about permissions. The caller must already
// have checked scopes, destination and spend ceilings against the
// AgentPrincipal. Returns as soon as the job is registered.

import crypto from "crypto";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createJob, registerJobAbort } from "@/lib/jobs";
import { broadcastPendingStart } from "@/lib/imageBroadcast";
import { resolveCredentialsForUser } from "@/lib/credentialStore";
import { runGenerationJob } from "@/lib/generation/pipeline";
import { provenanceFor, type AgentPrincipal } from "@/lib/agent/contract";
import type { AspectRatio, ModelId, Quality } from "@/lib/types";

export interface AgentGenerationRequest {
  principal: AgentPrincipal;
  prompt: string;
  model: ModelId;
  aspectRatio: AspectRatio;
  quality?: Quality;
  searchGrounding?: boolean;
  /** Resolved, ownership-checked workspace id, or null for the user's Main. */
  workspaceId: string | null;
  /** Reference images already decoded and downsampled below the inline ceiling. */
  referenceImages?: { base64: string; mimeType: string }[];
}

export interface AgentGenerationHandle {
  jobId: string;
  imageId: string;
}

/** Raised when the owning account cannot generate. Surfaced as a tool error. */
export class NoCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoCredentialsError";
  }
}

/**
 * Starts one generation on behalf of an agent and returns its job handle.
 *
 * Generation failures surface through the job rather than as a throw; the only
 * throw is for an account that has no usable credentials.
 */
export async function startAgentGeneration(
  req: AgentGenerationRequest,
): Promise<AgentGenerationHandle> {
  const { principal, prompt, model, aspectRatio, quality, searchGrounding, workspaceId, referenceImages } = req;
  const { userId } = principal;

  const credentials = resolveCredentialsForUser(userId);
  if (!credentials.sa) {
    throw new NoCredentialsError(
      credentials.access === "none"
        ? "This account is not permitted to generate images. An administrator must grant access."
        : "No Google credentials are configured for this account.",
    );
  }

  const owner = await db.query.users.findFirst({ where: eq(users.id, userId) });
  const username = owner?.username ?? "Unknown";

  const jobId = crypto.randomUUID();
  const imageId = crypto.randomUUID();
  createJob(jobId, userId);

  // Tell the owner's open tabs a generation has started, exactly as the browser
  // path does, so an agent's work shows a shimmer card rather than appearing
  // from nowhere when it completes.
  broadcastPendingStart(userId, {
    _eventKind: "pending_start",
    jobId,
    userId,
    workspaceId,
    prompt,
    model,
    aspectRatio,
    selectedAspectRatio: aspectRatio,
    quality: quality ?? null,
    startedAt: Date.now(),
  });

  const controller = new AbortController();
  registerJobAbort(jobId, () => controller.abort());

  void runGenerationJob({
    jobId,
    imageId,
    userId,
    username,
    prompt,
    model,
    aspectRatio,
    selectedAspectRatio: aspectRatio,
    quality,
    searchGrounding,
    workspaceId,
    referenceImages,
    // Agents can never publish to the shared feed as a side effect of
    // generating; publishing is a separate, separately-scoped tool.
    isShared: false,
    sa: credentials.sa,
    provenance: provenanceFor(principal),
    cancelSignal: controller.signal,
  });

  return { jobId, imageId };
}
