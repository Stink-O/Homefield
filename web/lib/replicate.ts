import type { AttachedImage } from "./types";

const REPLICATE_MODEL_MAP: Record<string, string> = {
  "gemini-3.1-flash-image-preview": "google/nano-banana-2",
  "gemini-3-pro-image-preview": "google/nano-banana-pro",
};

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string | string[];
  error?: string;
  logs?: string;
  urls: {
    get: string;
    cancel: string;
  };
}

export async function callReplicate(
  model: string,
  prompt: string,
  aspectRatio: string,
  images?: AttachedImage[],
  quality?: string,
  searchGrounding?: boolean,
  cancelSignal?: AbortSignal,
  onProcessing?: () => void
): Promise<{ base64: string; mimeType: string; grounded?: boolean }> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not configured");

  const replicateModel = REPLICATE_MODEL_MAP[model];
  if (!replicateModel) throw new Error(`Model ${model} not available on Replicate`);

  const isNB2 = model === "gemini-3.1-flash-image-preview";
  const hasRefImages = images && images.length > 0;

  const replicateAspectRatio = aspectRatio === "Auto"
    ? (hasRefImages ? "match_input_image" : "1:1")
    : aspectRatio;

  const imageInput = hasRefImages
    ? images!.map((img) => `data:${img.mimeType};base64,${img.base64}`)
    : undefined;

  const input: Record<string, unknown> = {
    prompt,
    aspect_ratio: replicateAspectRatio,
    resolution: quality ?? (isNB2 ? "1K" : "2K"),
    output_format: "jpg",
    ...(imageInput && { image_input: imageInput }),
    ...(isNB2 && { google_search: searchGrounding ?? false, image_search: searchGrounding ?? false }),
    ...(!isNB2 && {
      safety_filter_level: "block_only_high",
      allow_fallback_model: false,
    }),
  };

  if (cancelSignal?.aborted) throw new Error("Cancelled");

  const MAX_429_RETRIES = 4;
  let prediction: ReplicatePrediction | null = null;

  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    if (cancelSignal?.aborted) throw new Error("Cancelled");

    const createRes = await fetch(`https://api.replicate.com/v1/models/${replicateModel}/predictions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input }),
      signal: cancelSignal,
    });

    if (createRes.status === 429) {
      const err = await createRes.json().catch(() => ({}));
      const detail: string = err?.detail ?? "";
      // Parse "resets in ~Xs" or "resets in ~Xm" from the Replicate message
      const secMatch = detail.match(/resets in ~(\d+)s/);
      const minMatch = detail.match(/resets in ~(\d+)m/);
      const waitMs = secMatch
        ? (parseInt(secMatch[1], 10) + 1) * 1000
        : minMatch
        ? (parseInt(minMatch[1], 10) * 60 + 5) * 1000
        : (attempt + 1) * 5000;

      if (attempt === MAX_429_RETRIES) throw new Error(detail || "Replicate rate limit reached");
      console.log(`[HomeField] Replicate 429 — waiting ${waitMs}ms before retry ${attempt + 1}/${MAX_429_RETRIES}`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      throw new Error(err?.detail || `Replicate error (${createRes.status})`);
    }

    prediction = await createRes.json();
    break;
  }

  if (!prediction) throw new Error("Replicate prediction was not created");

  // Transient errors from Replicate (httpx.ReadTimeout, cold-start failures, etc.)
  // are retried by creating a fresh prediction. Non-transient errors surface immediately.
  const MAX_PREDICTION_RETRIES = 1;
  const TRANSIENT_ERROR_PATTERNS = [/ReadTimeout/i, /timeout/i, /connection/i, /cold/i];

  const isTransient = (err: string | undefined, logs: string | undefined) => {
    const haystack = `${err ?? ""} ${logs ?? ""}`;
    return haystack.trim().length > 0 && TRANSIENT_ERROR_PATTERNS.some((re) => re.test(haystack));
  };

  const FIRST_POLL_MS = 500;
  const POLL_INTERVAL_MS = 2_000;
  const POLL_TIMEOUT_MS = 180_000;

  for (let attempt = 0; attempt <= MAX_PREDICTION_RETRIES; attempt++) {
    if (attempt > 0) {
      // Brief pause before retry so the worker has time to recover
      await new Promise((r) => setTimeout(r, 2_000));
      if (cancelSignal?.aborted) throw new Error("Cancelled");

      // Create a fresh prediction for the retry
      const retryRes = await fetch(`https://api.replicate.com/v1/models/${replicateModel}/predictions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
        signal: cancelSignal,
      });
      if (!retryRes.ok) {
        const err = await retryRes.json().catch(() => ({}));
        throw new Error(err?.detail || `Replicate error (${retryRes.status})`);
      }
      prediction = await retryRes.json();
      console.log(`[HomeField] Replicate retry ${attempt}/${MAX_PREDICTION_RETRIES} — new prediction ${prediction!.id}`);
    }

    // Poll for status — first check at 500ms, then every 2s
    let processingFired = false;
    const pollStart = Date.now();
    let firstPoll = true;

    while (
      prediction!.status !== "succeeded" &&
      prediction!.status !== "failed" &&
      prediction!.status !== "canceled"
    ) {
      if (cancelSignal?.aborted) {
        fetch(prediction!.urls.cancel, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` },
        }).catch(() => {});
        throw new Error("Cancelled");
      }
      if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
        throw new Error("Replicate prediction timed out");
      }
      await new Promise((r) => setTimeout(r, firstPoll ? FIRST_POLL_MS : POLL_INTERVAL_MS));
      firstPoll = false;
      if (cancelSignal?.aborted) {
        fetch(prediction!.urls.cancel, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` },
        }).catch(() => {});
        throw new Error("Cancelled");
      }
      const pollRes: Response = await fetch(prediction!.urls.get, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!pollRes.ok) throw new Error(`Replicate poll error (${pollRes.status})`);
      prediction = await pollRes.json();

      if (!processingFired && prediction!.status === "processing") {
        processingFired = true;
        onProcessing?.();
      }
    }

    if (prediction!.status === "canceled") {
      throw new Error("Cancelled");
    }

    if (prediction!.status === "failed") {
      console.error("[HomeField] Replicate prediction failed:", JSON.stringify({
        id: prediction!.id,
        error: prediction!.error,
        attempt,
        logs: prediction!.logs?.slice(-500),
      }));
      if (isTransient(prediction!.error, prediction!.logs) && attempt < MAX_PREDICTION_RETRIES) {
        console.log(`[HomeField] Transient error detected — retrying (${attempt + 1}/${MAX_PREDICTION_RETRIES})`);
        continue;
      }
      // Use last non-empty log line as error message when prediction.error is blank
      const logTail = prediction!.logs?.trim().split("\n").filter(Boolean).pop();
      throw new Error(prediction!.error || logTail || "Replicate generation failed");
    }

    // succeeded — break out of retry loop
    break;
  }

  // Replicate's schema declares output as a single string URI, but some model versions
  // return an array. Handle both defensively.
  const rawOutput = prediction!.output as unknown;
  const outputUrl = Array.isArray(rawOutput) ? rawOutput[0] : rawOutput as string | undefined;

  console.log("[HomeField] Replicate output:", JSON.stringify(rawOutput));

  if (!outputUrl) throw new Error("No output from Replicate");

  const imgRes = await fetch(outputUrl);
  if (!imgRes.ok) throw new Error(`Failed to download Replicate output (${imgRes.status})`);
  const arrayBuffer = await imgRes.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = imgRes.headers.get("content-type")?.split(";")[0] || "image/jpeg";

  return { base64, mimeType, grounded: false };
}
