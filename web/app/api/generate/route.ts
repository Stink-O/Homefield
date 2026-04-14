import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createJob, resolveJob, failJob, registerJobAbort, unregisterJobAbort } from "@/lib/jobs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { images, users, workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { saveImageFile, saveReferenceImages, deleteImageFile, deleteReferenceImages } from "@/lib/fileStorage";
import { broadcastShared } from "@/lib/sharedBroadcast";
import { broadcastImage, broadcastPendingStart, broadcastPendingEnd, broadcastPendingProcessing } from "@/lib/imageBroadcast";
import { broadcastSharedPendingStart, broadcastSharedPendingEnd } from "@/lib/sharedBroadcast";
import { registerSharedPending, clearSharedPending } from "@/lib/sharedPending";
import { checkRateLimit } from "@/lib/rateLimit";
import { callReplicate } from "@/lib/replicate";

// --- Input validation constants ---

// Allowlisted model IDs. Arbitrary strings must never reach the Vertex AI URL.
const ALLOWED_MODELS = new Set([
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "imagen-3.0-generate-001",
]);

// Allowlisted aspect ratios sourced from types.ts ASPECT_RATIOS.
const ALLOWED_ASPECT_RATIOS = new Set([
  "Auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9",
]);

const ALLOWED_QUALITIES = new Set(["1K", "2K", "4K"]);

// Maximum base64 string length for a single reference image.
// Vertex AI allows 7 MB per image; base64 encodes at ~4/3x, so ~9.5 MB. Use 10 MB as ceiling.
const MAX_IMAGE_BASE64_LENGTH = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Maximum reference images per request (matches MODEL_IMAGE_LIMITS in types.ts)
const MAX_REF_IMAGES = 14;

// Maximum prompt length in characters
const MAX_PROMPT_LENGTH = 4000;

// UUID v4 regex for workspaceId validation
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// App Router: mark this route as always dynamic (never statically cached).
// This is a fire-and-forget generation endpoint; caching would be wrong.
export const dynamic = "force-dynamic";

interface ServiceAccount {
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

// R3: Parse and validate service account credentials at module load time.
// If the env var is set but malformed, throw immediately so the misconfiguration is
// visible at startup rather than silently failing at request time.
function parseServiceAccount(raw: string): ServiceAccount {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON: not valid JSON");
  }
  for (const field of ["private_key", "client_email", "token_uri", "project_id"] as const) {
    if (typeof parsed[field] !== "string" || !(parsed[field] as string)) {
      throw new Error(`Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON: missing field ${field}`);
    }
  }
  return parsed as unknown as ServiceAccount;
}

const _credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
// Only parse at module level if the env var is present; absence is handled per-request.
const MODULE_SA: ServiceAccount | null = _credJson ? parseServiceAccount(_credJson) : null;

function createJWT(sa: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  })).toString("base64url");

  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  const signature = sign.sign(sa.private_key, "base64url");
  return `${signingInput}.${signature}`;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

// --- Vertex AI concurrency limiter ---
// Preview Gemini models have strict QPM quotas. Bursting N concurrent requests
// exhausts the quota window immediately and causes all of them to fail with 429.
// This semaphore serializes Vertex AI calls (one at a time) so they stagger
// naturally. Increase MAX_CONCURRENT_VERTEX if your quota allows it.
const MAX_CONCURRENT_VERTEX = 1;
let vertexInflight = 0;

interface VertexQueueEntry {
  tryAcquire: () => void;
  drain: (err: Error) => void;
}
const vertexWaitQueue: VertexQueueEntry[] = [];

function acquireVertexSlot(): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const entry: VertexQueueEntry = {
      tryAcquire: () => {
        if (vertexInflight < MAX_CONCURRENT_VERTEX) {
          vertexInflight++;
          resolve(() => {
            vertexInflight--;
            if (vertexWaitQueue.length > 0) vertexWaitQueue.shift()!.tryAcquire();
          });
        } else {
          vertexWaitQueue.push(entry);
        }
      },
      drain: (err: Error) => reject(err),
    };
    entry.tryAcquire();
  });
}

// Immediately reject all queued jobs. Called when a quota-exhausted error
// is confirmed — there's no point making queued jobs wait and retry.
function drainVertexQueue(err: Error): void {
  const queued = vertexWaitQueue.splice(0);
  for (const entry of queued) {
    entry.drain(err);
  }
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  // Reuse token if it has more than 5 minutes remaining
  if (cachedToken && cachedToken.expiresAt - Date.now() > 5 * 60 * 1000) {
    return cachedToken.value;
  }
  const jwt = createJWT(sa);
  const tokenController = new AbortController();
  const tokenTimer = setTimeout(() => tokenController.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(sa.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
      signal: tokenController.signal,
    });
  } finally {
    clearTimeout(tokenTimer);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description || "Failed to get access token");
  }
  const data = await res.json();
  // Tokens are valid for 1 hour; cache with a conservative expiry
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

// 429 gets more retries than transient server errors
const MAX_RETRIES: Record<number, number> = { 429: 6, 500: 1, 503: 3 };

// Truncated exponential backoff with full jitter (recommended by Google)
// delay = min(cap, base * 2^attempt) + random jitter
function backoffMs(attempt: number, status: number): number {
  const base = status === 429 ? 2000 : 1000;
  const cap = status === 429 ? 30000 : 10000;
  const expo = Math.min(cap, base * Math.pow(2, attempt));
  return expo + Math.random() * 1000; // add up to 1s of jitter
}

// How long to wait for a single Vertex AI response before giving up
const VERTEX_TIMEOUT_MS = 180_000;

// Fallback region used when the global endpoint exhausts retries on 429 or 5xx.
// us-east4 has an independent quota pool from us-central1.
const FALLBACK_REGION = "us-east4";

async function fetchWithRetry(url: string, options: RequestInit, cancelSignal?: AbortSignal): Promise<Response> {
  let attempt = 0;
  while (true) {
    if (cancelSignal?.aborted) throw new Error("Cancelled");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERTEX_TIMEOUT_MS);
    // Forward cancellation to the inner abort controller
    const onCancel = () => controller.abort();
    cancelSignal?.addEventListener("abort", onCancel, { once: true });
    let res: Response;
    try {
      res = await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      cancelSignal?.removeEventListener("abort", onCancel);
      if (err instanceof Error && err.name === "AbortError") {
        if (cancelSignal?.aborted) throw new Error("Cancelled");
        throw new Error(`Vertex AI request timed out after ${VERTEX_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    }
    clearTimeout(timer);
    cancelSignal?.removeEventListener("abort", onCancel);
    if (res.ok) return res;
    // Detect quota exhaustion (daily/project limit) vs transient rate limiting.
    // RESOURCE_EXHAUSTED won't recover within any retry window — fail immediately
    // so the queue drain can kick in and queued jobs don't waste time retrying too.
    if (res.status === 429) {
      const clone = res.clone();
      const body = await clone.json().catch(() => null);
      if (body?.error?.status === "RESOURCE_EXHAUSTED") return res;
    }
    const maxRetries = MAX_RETRIES[res.status] ?? 0;
    if (maxRetries === 0 || attempt >= maxRetries) return res;
    if (cancelSignal?.aborted) throw new Error("Cancelled");
    await new Promise((r) => setTimeout(r, backoffMs(attempt, res.status)));
    attempt++;
  }
}

// Try each URL in sequence; advance only on 429 or 5xx after retries are exhausted.
// Non-retriable 4xx errors are returned immediately from whichever URL produced them.
async function fetchWithFallback(
  urls: string[],
  options: RequestInit,
  cancelSignal?: AbortSignal
): Promise<Response> {
  let res: Response | undefined;
  for (let i = 0; i < urls.length; i++) {
    res = await fetchWithRetry(urls[i], options, cancelSignal);
    if (res.ok) return res;
    if (res.status >= 400 && res.status < 500 && res.status !== 429) return res;
    if (i < urls.length - 1) {
      console.warn(`[HomeField] ${urls[i]} returned ${res.status}, trying fallback region ${FALLBACK_REGION}`);
    }
  }
  return res!;
}

// R1: Token is fetched inside each function just before the Vertex AI call so it is
// always fresh, even for long-running generations that exceed the original token lifetime.
async function callImagen(
  sa: ServiceAccount,
  model: string,
  prompt: string,
  aspectRatio: string,
  cancelSignal?: AbortSignal
): Promise<{ base64: string; mimeType: string; grounded?: boolean }> {
  const accessToken = await getAccessToken(sa);
  const urls = [
    `https://aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/global/publishers/google/models/${model}:predict`,
    `https://${FALLBACK_REGION}-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/${FALLBACK_REGION}/publishers/google/models/${model}:predict`,
  ];
  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      ...(aspectRatio && aspectRatio !== "Auto" && { aspectRatio }),
      safetySetting: "block_few",
      personGeneration: "allow_all",
    },
  };
  const res = await fetchWithFallback(urls, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  }, cancelSignal);
  // R2: Wrap res.json() so a malformed response body never throws a raw SyntaxError.
  let data: { predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>; error?: { message?: string; status?: string } };
  try {
    data = await res.json();
  } catch {
    throw new Error(`Vertex AI returned a non-JSON response (status ${res.status})`);
  }
  if (!res.ok) {
    console.error(`[HomeField] Imagen ${res.status}:`, JSON.stringify(data?.error ?? data));
    const isQuotaExhausted = res.status === 429 && data?.error?.status === "RESOURCE_EXHAUSTED";
    const msg = isQuotaExhausted
      ? "Quota exhausted — check your Vertex AI limits or try again later"
      : res.status === 429
      ? "Rate limit reached — please wait a moment and retry"
      : data?.error?.message || `Vertex AI error (${res.status})`;
    throw new Error(msg);
  }
  const prediction = data.predictions?.[0];
  if (!prediction?.bytesBase64Encoded) throw new Error("No image generated");
  return { base64: prediction.bytesBase64Encoded, mimeType: prediction.mimeType || "image/png" };
}

interface AttachedImage {
  base64: string;
  mimeType: string;
}

// R1: Token is fetched inside the function just before the Vertex AI call.
async function callGemini(
  sa: ServiceAccount,
  model: string,
  prompt: string,
  aspectRatio: string,
  images?: AttachedImage[],
  quality?: string,
  searchGrounding?: boolean,
  cancelSignal?: AbortSignal
): Promise<{ base64: string; mimeType: string; grounded?: boolean }> {
  const accessToken = await getAccessToken(sa);
  // Gemini image preview models are only available via the global endpoint — regional
  // endpoints (e.g. us-east4) return 404. Use fetchWithRetry directly so 429s are
  // retried with backoff against the same global URL rather than falling through to a
  // regional fallback that will always fail.
  const globalUrl = `https://aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/global/publishers/google/models/${model}:generateContent`;

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  // Instruction before image: Gemini enters edit/transform mode more reliably when
  // the text instruction comes first, then the reference image(s) to apply it to.
  parts.push({ text: prompt });
  if (images && images.length > 0) {
    for (const img of images) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
    }
  }

  const body = {
    contents: [{ role: "user", parts }],
    ...(searchGrounding && { tools: [{ googleSearch: {} }] }),
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      ...((aspectRatio && aspectRatio !== "Auto") || quality
        ? {
          imageConfig: {
            ...(aspectRatio && aspectRatio !== "Auto" && { aspectRatio }),
            ...(quality && { imageSize: quality }),
          }
        }
        : {}),
    },
  };
  const res = await fetchWithRetry(globalUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  }, cancelSignal);
  // R2: Wrap res.json() so a malformed response body never throws a raw SyntaxError.
  let data: {
    candidates?: Array<{
      content?: { parts?: Array<Record<string, unknown>> };
      finishReason?: string;
      safetyRatings?: unknown;
      groundingMetadata?: unknown;
    }>;
    promptFeedback?: unknown;
    error?: { message?: string; status?: string };
  };
  try {
    data = await res.json();
  } catch {
    throw new Error(`Vertex AI returned a non-JSON response (status ${res.status})`);
  }
  if (!res.ok) {
    console.error(`[HomeField] Gemini ${res.status}:`, JSON.stringify(data?.error ?? data));
    const isQuotaExhausted = res.status === 429 && data?.error?.status === "RESOURCE_EXHAUSTED";
    const msg = isQuotaExhausted
      ? "Quota exhausted — check your Vertex AI limits or try again later"
      : res.status === 429
      ? "Rate limit reached — please wait a moment and retry"
      : data?.error?.message || `Vertex AI error (${res.status})`;
    throw new Error(msg);
  }
  const candidate = data.candidates?.[0];
  const responseParts = candidate?.content?.parts;
  const imagePart = responseParts?.find((p: { inlineData?: { mimeType: string; data: string } }) => p.inlineData);
  if (!imagePart?.inlineData) {
    // Diagnostic: log the full response so we can see what the API actually returned
    console.error("[HomeField] callGemini — no image in response. Full response:", JSON.stringify({
      candidateCount: data.candidates?.length ?? 0,
      finishReason: candidate?.finishReason,
      promptFeedback: data.promptFeedback,
      safetyRatings: candidate?.safetyRatings,
      partTypes: responseParts?.map((p: Record<string, unknown>) => Object.keys(p)),
      textParts: responseParts?.filter((p: { text?: string }) => p.text).map((p: { text?: string }) => p.text?.slice(0, 200)),
    }));
    throw new Error("No image in response");
  }
  const grounded = !!(candidate?.groundingMetadata);
  return { base64: (imagePart.inlineData as { mimeType: string; data: string }).data, mimeType: (imagePart.inlineData as { mimeType: string; data: string }).mimeType, grounded };
}

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

  // prompt: required string, capped at MAX_PROMPT_LENGTH
  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "Prompt required" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `Prompt must be at most ${MAX_PROMPT_LENGTH} characters` },
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

  const sa = MODULE_SA;

  // Fetch username for shared broadcast (do this before the fire-and-forget)
  const username = session.user?.name ?? "Unknown";

  const jobId = crypto.randomUUID();
  const imageId = crypto.randomUUID();
  createJob(jobId);

  // Resolve the effective model now so we can include it in the pending broadcast.
  const selectedModel = (typeof model === "string" && model) ? model : "imagen-3.0-generate-001";
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

  // Fire-and-forget: run generation in the background
  (async () => {
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
            aspectRatio as string ?? "Auto",
            validatedRefImages,
            quality as string | undefined,
            searchGrounding as boolean | undefined,
            genController.signal,
            () => broadcastPendingProcessing(userId, jobId)
          );
        } catch (replicateErr) {
          if (genController.signal.aborted) throw replicateErr;
          // Replicate failed — fall back to Vertex AI if credentials are available.
          if (!sa) throw replicateErr;
          console.warn(`[HomeField] ${jobId.slice(0, 8)} Replicate failed, falling back to Vertex AI:`, replicateErr instanceof Error ? replicateErr.message : replicateErr);
          const releaseSlot = await acquireVertexSlot();
          try {
            result = await callGemini(sa, selectedModel, prompt as string, aspectRatio as string ?? "Auto", validatedRefImages, quality as string | undefined, searchGrounding as boolean | undefined, genController.signal);
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
            ? await callGemini(sa, selectedModel, prompt as string, aspectRatio as string ?? "Auto", validatedRefImages, quality as string | undefined, searchGrounding as boolean | undefined, genController.signal)
            : await callImagen(sa, selectedModel, prompt as string, aspectRatio as string ?? "1:1", genController.signal);
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
          aspectRatio: aspectRatio ?? "1:1",
          selectedAspectRatio: selectedAspectRatio ?? aspectRatio ?? "Auto",
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
          aspectRatio: aspectRatio ?? "1:1",
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
          aspectRatio: aspectRatio ?? "1:1",
          selectedAspectRatio: (selectedAspectRatio ?? aspectRatio ?? "Auto") as string,
          quality: quality ?? null,
          width,
          height,
          thumbnailUrl,
          mimeType: result.mimeType,
          timestamp,
          searchGrounding: result.grounded ?? false,
          referenceImageDataUrls: refPaths.length > 0 ? refPaths.map((p) => `/api/files/${p}`) : undefined,
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
  })();

  return NextResponse.json({ jobId });
}
