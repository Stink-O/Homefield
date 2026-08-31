// Vertex AI / Gemini transport layer.
//
// Extracted from app/api/generate/route.ts so both the browser-facing route and
// the agent path share one implementation of the concurrency semaphore, the
// retry/backoff policy and the request shapes. Behaviour is unchanged.

import { ServiceAccount, getAccessToken } from "@/lib/vertexAuth";
import { AttachedImage } from "@/lib/types";

// Credentials are resolved per request (encrypted DB value first, then env var)
// so an admin can add or change the key from the web UI without a restart. See
// lib/credentialStore.ts.

// --- Vertex AI concurrency limiter ---
// Preview Gemini models have strict QPM quotas. Bursting N concurrent requests
// exhausts the quota window immediately and causes all of them to fail with 429.
// This semaphore serializes Vertex AI calls (one at a time) so they stagger
// naturally. Increase MAX_CONCURRENT_VERTEX if your quota allows it.
const MAX_CONCURRENT_VERTEX = 1;

interface VertexQueueEntry {
  tryAcquire: () => void;
  drain: (err: Error) => void;
}

// Each Next.js route bundle gets its own instance of this module, so the
// semaphore state has to live on globalThis or the browser path and the agent
// path would each get their own limiter and burst Vertex to a 429.
declare global {
   
  var __hf_vertex_sem: { inflight: number; queue: VertexQueueEntry[] } | undefined;
}
if (!globalThis.__hf_vertex_sem) {
  globalThis.__hf_vertex_sem = { inflight: 0, queue: [] };
}
const sem = globalThis.__hf_vertex_sem;

export function acquireVertexSlot(): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const entry: VertexQueueEntry = {
      tryAcquire: () => {
        if (sem.inflight < MAX_CONCURRENT_VERTEX) {
          sem.inflight++;
          resolve(() => {
            sem.inflight--;
            if (sem.queue.length > 0) sem.queue.shift()!.tryAcquire();
          });
        } else {
          sem.queue.push(entry);
        }
      },
      drain: (err: Error) => reject(err),
    };
    entry.tryAcquire();
  });
}

// Immediately reject all queued jobs. Called when a quota-exhausted error
// is confirmed — there's no point making queued jobs wait and retry.
export function drainVertexQueue(err: Error): void {
  const queued = sem.queue.splice(0);
  for (const entry of queued) {
    entry.drain(err);
  }
}

// 429 gets more retries than transient server errors
const MAX_RETRIES: Record<number, number> = { 429: 6, 500: 1, 502: 2, 503: 3 };

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
export async function callImagen(
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

type GeminiStreamPart = { text?: string; inlineData?: { mimeType: string; data: string } };
type GeminiStreamChunk = {
  candidates?: Array<{
    content?: { parts?: GeminiStreamPart[] };
    finishReason?: string;
    safetyRatings?: unknown;
    groundingMetadata?: unknown;
  }>;
  promptFeedback?: unknown;
  error?: { message?: string; status?: string };
};

// streamGenerateContent on Vertex AI returns a JSON array: [{chunk1}, {chunk2}, ...].
// Merge all chunks into the same shape as a generateContent response
// so the rest of callGemini can parse it identically.
// Falls back to NDJSON (one object per line) in case the format varies.
function mergeStreamChunks(text: string): GeminiStreamChunk {
  const parts: GeminiStreamPart[] = [];
  let finishReason: string | undefined;
  let safetyRatings: unknown;
  let groundingMetadata: unknown;
  let promptFeedback: unknown;
  let errorChunk: GeminiStreamChunk | undefined;

  let chunks: GeminiStreamChunk[] = [];
  try {
    // Primary: Vertex AI REST streaming returns a JSON array
    const parsed = JSON.parse(text);
    chunks = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Fallback: NDJSON (one JSON object per line)
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { chunks.push(JSON.parse(trimmed)); } catch { continue; }
    }
  }

  for (const chunk of chunks) {
    if (chunk.error) { errorChunk = chunk; break; }
    const candidate = chunk.candidates?.[0];
    if (candidate?.content?.parts) parts.push(...candidate.content.parts);
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    if (candidate?.safetyRatings) safetyRatings = candidate.safetyRatings;
    if (candidate?.groundingMetadata) groundingMetadata = candidate.groundingMetadata;
    if (chunk.promptFeedback) promptFeedback = chunk.promptFeedback;
  }
  if (errorChunk) return errorChunk;
  return { candidates: [{ content: { parts }, finishReason, safetyRatings, groundingMetadata }], promptFeedback };
}

// R1: Token is fetched inside the function just before the Vertex AI call.
export async function callGemini(
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
  // Gemini image models are only available via the global endpoint — regional
  // endpoints (e.g. us-east4) return 404. Use fetchWithRetry directly so 429s are
  // retried with backoff against the same global URL rather than falling through to a
  // regional fallback that will always fail.
  // 2K/4K: generateContent silently ignores imageConfig.imageSize on the Flash model;
  // streamGenerateContent honours it correctly (confirmed workaround for GA endpoint).
  const useStream = quality === "2K" || quality === "4K";
  const globalUrl = `https://aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/global/publishers/google/models/${model}:${useStream ? "streamGenerateContent" : "generateContent"}`;

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
  // R2: Parse response — streaming (NDJSON) path for 2K/4K, JSON for everything else.
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
    if (useStream && res.ok) {
      const raw = await res.text();
      data = mergeStreamChunks(raw);
    } else {
      data = await res.json();
    }
  } catch {
    throw new Error(`Vertex AI returned a non-JSON response (status ${res.status})`);
  }
  if (!res.ok) {
    console.error(`[HomeField] Gemini ${res.status} model=${model}:`, JSON.stringify(data?.error ?? data));
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

