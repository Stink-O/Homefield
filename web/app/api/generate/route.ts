import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { resolveCredentialsForUser } from "@/lib/credentialStore";
import { MAX_PROMPT_LENGTH } from "@/lib/types";
import { createJob, registerJobAbort } from "@/lib/jobs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { runGenerationJob } from "@/lib/generation/pipeline";
import { broadcastPendingStart } from "@/lib/imageBroadcast";
import { broadcastSharedPendingStart } from "@/lib/sharedBroadcast";
import { registerSharedPending } from "@/lib/sharedPending";
import { checkRateLimit } from "@/lib/rateLimit";

// --- Input validation constants ---

// Allowlisted model IDs. Arbitrary strings must never reach the Vertex AI URL.
const ALLOWED_MODELS = new Set([
  "gemini-3.1-flash-image",
  "gemini-3-pro-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-lite-image",
  "imagen-3.0-generate-001",
]);

const LEGACY_MODEL_MAP: Record<string, string> = {
  "gemini-3.1-flash-image-preview": "gemini-3.1-flash-image",
  "gemini-3-pro-image-preview":     "gemini-3-pro-image",
};
function normalizeModel(id: string): string {
  return LEGACY_MODEL_MAP[id] ?? id;
}

// Allowlisted aspect ratios sourced from types.ts ASPECT_RATIOS.
const ALLOWED_ASPECT_RATIOS = new Set([
  "Auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9",
]);

const ALLOWED_QUALITIES = new Set(["512", "1K", "2K", "4K"]);

// Maximum prompt length: MAX_PROMPT_LENGTH (imported from types.ts). Template
// prompts can be long JSON blocks, but anything beyond this is abuse — it would
// be stored in SQLite and re-broadcast over SSE.

// Maximum base64 string length for a single reference image.
// Vertex AI allows 7 MB per image; base64 encodes at ~4/3x, so ~9.5 MB. Use 10 MB as ceiling.
const MAX_IMAGE_BASE64_LENGTH = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Maximum reference images per request (matches MODEL_IMAGE_LIMITS in types.ts)
const MAX_REF_IMAGES = 14;


// UUID v4 regex for workspaceId validation
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// App Router: mark this route as always dynamic (never statically cached).
// This is a fire-and-forget generation endpoint; caching would be wrong.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Auth check
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userRole = (session.user as { id: string; role?: string }).role;

  // OWASP: Rate limit per authenticated user — 30 generations per 10 minutes.
  // Admins are exempt so they can test without hitting the limit.
  const rl = userRole === "admin"
    ? { allowed: true, retryAfterMs: 0 }
    : checkRateLimit(`generate:${userId}`, 30, 10 * 60 * 1000);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
    return NextResponse.json(
      { error: "Rate limit reached — please wait before generating more images." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid or oversized request body" }, { status: 400 });
  }

  // OWASP: Extract only expected fields — ignore unexpected properties on the body object.
  const {
    prompt,
    model,
    aspectRatio,
    selectedAspectRatio,
    images: refImages,
    quality,
    searchGrounding,
    workspaceId,
    isShared,
    clientId,
  } = body as {
    prompt: unknown;
    model?: unknown;
    aspectRatio?: unknown;
    selectedAspectRatio?: unknown;
    images?: unknown;
    quality?: unknown;
    searchGrounding?: unknown;
    workspaceId?: unknown;
    isShared?: unknown;
    clientId?: unknown;
  };

  // --- Strict input validation ---

  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "Prompt required" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters` },
      { status: 400 },
    );
  }

  // model: must be an allowlisted value (or absent, which defaults to imagen)
  if (model !== undefined && (typeof model !== "string" || !ALLOWED_MODELS.has(model))) {
    return NextResponse.json({ error: "Invalid model" }, { status: 400 });
  }

  // aspectRatio: must be an allowlisted value if provided
  if (aspectRatio !== undefined && (typeof aspectRatio !== "string" || !ALLOWED_ASPECT_RATIOS.has(aspectRatio))) {
    return NextResponse.json({ error: "Invalid aspect ratio" }, { status: 400 });
  }

  // selectedAspectRatio: same allowlist, optional
  if (selectedAspectRatio !== undefined && (typeof selectedAspectRatio !== "string" || !ALLOWED_ASPECT_RATIOS.has(selectedAspectRatio))) {
    return NextResponse.json({ error: "Invalid selected aspect ratio" }, { status: 400 });
  }

  // quality: must be an allowlisted value if provided
  if (quality !== undefined && (typeof quality !== "string" || !ALLOWED_QUALITIES.has(quality))) {
    return NextResponse.json({ error: "Invalid quality" }, { status: 400 });
  }

  // 512 is only supported by the Flash model
  if (quality === "512" && model !== "gemini-3.1-flash-image") {
    return NextResponse.json({ error: "512 quality is only supported for the Flash model" }, { status: 400 });
  }

  // Lite caps output at 1 Megapixel — no 2K/4K tier
  if ((quality === "2K" || quality === "4K") && model === "gemini-3.1-flash-lite-image") {
    return NextResponse.json({ error: "2K/4K quality is not supported for the Lite model" }, { status: 400 });
  }

  // searchGrounding: must be a boolean if provided
  if (searchGrounding !== undefined && typeof searchGrounding !== "boolean") {
    return NextResponse.json({ error: "Invalid searchGrounding" }, { status: 400 });
  }

  // isShared: must be a boolean if provided
  if (isShared !== undefined && typeof isShared !== "boolean") {
    return NextResponse.json({ error: "Invalid isShared" }, { status: 400 });
  }

  // workspaceId: must be a UUID v4 string if provided
  if (workspaceId !== undefined && (typeof workspaceId !== "string" || !UUID_RE.test(workspaceId))) {
    return NextResponse.json({ error: "Invalid workspaceId" }, { status: 400 });
  }

  // Validate workspaceId ownership early — before starting an expensive Vertex AI call.
  if (workspaceId) {
    const ws = await db.query.workspaces.findFirst({
      where: (w, { and, eq }) => and(eq(w.id, workspaceId as string), eq(w.userId, userId)),
    });
    if (!ws) return NextResponse.json({ error: "Invalid workspace" }, { status: 400 });
  }

  // clientId: optional opaque string from the client, capped at 64 chars
  if (clientId !== undefined && (typeof clientId !== "string" || clientId.length > 64)) {
    return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });
  }

  // images: validate count, size, and mimeType for each reference image
  let validatedRefImages: { base64: string; mimeType: string }[] | undefined;
  if (refImages !== undefined) {
    if (!Array.isArray(refImages)) {
      return NextResponse.json({ error: "images must be an array" }, { status: 400 });
    }
    if (refImages.length > MAX_REF_IMAGES) {
      return NextResponse.json(
        { error: `At most ${MAX_REF_IMAGES} reference images are allowed` },
        { status: 400 },
      );
    }
    for (let i = 0; i < refImages.length; i++) {
      const img = refImages[i];
      if (typeof img !== "object" || img === null) {
        return NextResponse.json({ error: `images[${i}]: invalid entry` }, { status: 400 });
      }
      const { base64, mimeType } = img as Record<string, unknown>;
      if (typeof base64 !== "string" || base64.length === 0) {
        return NextResponse.json({ error: `images[${i}]: base64 is required` }, { status: 400 });
      }
      if (base64.length > MAX_IMAGE_BASE64_LENGTH) {
        return NextResponse.json(
          { error: `images[${i}]: exceeds maximum size of 10 MB` },
          { status: 400 },
        );
      }
      if (typeof mimeType !== "string" || !ALLOWED_MIME_TYPES.has(mimeType)) {
        return NextResponse.json(
          { error: `images[${i}]: mimeType must be image/jpeg, image/png, or image/webp` },
          { status: 400 },
        );
      }
    }
    validatedRefImages = refImages as { base64: string; mimeType: string }[];
  }

  // Credentials are resolved per user so each account can bill its own Google
  // project. See lib/credentialStore.ts for the own/shared/none tiers.
  const credentials = resolveCredentialsForUser(userId);
  const sa = credentials.sa;

  // Fetch username for shared broadcast (do this before the fire-and-forget)
  const username = session.user?.name ?? "Unknown";

  const jobId = crypto.randomUUID();
  const imageId = crypto.randomUUID();
  // Jobs are owner-scoped: an ownerless job is inaccessible to everyone, so the
  // userId must be recorded here or the creator's own polling returns 404.
  createJob(jobId, userId);

  // Resolve the effective model now so we can include it in the pending broadcast.
  // Normalize legacy preview IDs to their GA equivalents before any API call.
  const selectedModel = normalizeModel((typeof model === "string" && model) ? model : "imagen-3.0-generate-001");
  const startedAt = Date.now();

  // Broadcast to all devices logged in as this user that a new generation is starting.
  // Other devices will show a shimmer card for this job.
  if (!isShared) {
    broadcastPendingStart(userId, {
      _eventKind: "pending_start",
      jobId,
      clientId: typeof clientId === "string" ? clientId : undefined,
      userId,
      workspaceId: typeof workspaceId === "string" ? workspaceId : null,
      prompt: prompt as string,
      model: selectedModel,
      aspectRatio: (typeof aspectRatio === "string" ? aspectRatio : null) ?? "1:1",
      selectedAspectRatio: (typeof selectedAspectRatio === "string" ? selectedAspectRatio : typeof aspectRatio === "string" ? aspectRatio : "Auto") as string,
      quality: typeof quality === "string" ? quality : null,
      startedAt,
    });
  }

  // Track shared generations server-side so clients can show shimmers after a refresh,
  // and broadcast live so clients already on the shared page see the shimmer immediately.
  if (isShared) {
    registerSharedPending({
      jobId,
      prompt,
      aspectRatio: aspectRatio ?? "1:1",
      startedAt,
    });
    broadcastSharedPendingStart({
      _eventKind: "shared_pending_start",
      jobId,
      clientId: typeof clientId === "string" ? clientId : undefined,
      userId,
      username,
      prompt: prompt as string,
      aspectRatio: (typeof aspectRatio === "string" ? aspectRatio : null) ?? "1:1",
      startedAt,
    });
  }

  // Per-job AbortController so cancellation can abort the in-flight Vertex call.
  const genController = new AbortController();
  registerJobAbort(jobId, () => genController.abort());

  // Fire-and-forget: the shared pipeline writes the image, the row and the
  // broadcasts. Deliberately not awaited — the client polls or streams the job.
  void runGenerationJob({
    jobId,
    imageId,
    userId,
    username,
    prompt: prompt as string,
    model: selectedModel,
    aspectRatio: (aspectRatio as string) ?? "Auto",
    selectedAspectRatio: (selectedAspectRatio ?? aspectRatio ?? "Auto") as string,
    quality: quality as string | undefined,
    searchGrounding: searchGrounding as boolean | undefined,
    workspaceId: typeof workspaceId === "string" ? workspaceId : null,
    referenceImages: validatedRefImages,
    isShared: isShared === true,
    sa,
    cancelSignal: genController.signal,
  });

  return NextResponse.json({ jobId });
}
