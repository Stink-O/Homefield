import { ModelId, AspectRatio, AttachedImage, Quality } from "./types";
import { addPendingJob, removePendingJob } from "./pendingJobs";

export interface GenerateResult {
  imageId: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  mimeType: string;
  grounded?: boolean;
  referenceImageDataUrls?: string[];
}

// Registry of in-flight waitForJob promises, keyed by jobId.
// AppContext resolves these when the SSE stream delivers the completed image —
// eliminating polling entirely. No HTTP/1.1 connection slots are held open.
export const pendingJobs = new Map<string, {
  resolve: (r: GenerateResult) => void;
  reject: (e: Error) => void;
}>();

// Tracks jobIds started on this device so AppContext can skip adding a remote
// pending shimmer for generations that already have a local shimmer card.
export const localJobIds = new Set<string>();

// Waits for a job to complete. Registers in pendingJobs so the SSE stream in
// AppContext can resolve it without any polling. A single one-shot fetch checks
// whether the job already finished before the SSE reconnected (page reload case).
function waitForJob(jobId: string, signal?: AbortSignal): Promise<GenerateResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    let settled = false;
    let deadlineHandle: ReturnType<typeof setTimeout> | null = null;
    let pollHandle: ReturnType<typeof setInterval> | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (deadlineHandle !== null) clearTimeout(deadlineHandle);
      if (pollHandle !== null) clearInterval(pollHandle);
      pendingJobs.delete(jobId);
      localJobIds.delete(jobId);
      fn();
    };

    signal?.addEventListener("abort", () => {
      finish(() => reject(new DOMException("Aborted", "AbortError")));
    }, { once: true });

    deadlineHandle = setTimeout(() => {
      finish(() => reject(new Error("Generation timed out")));
    }, 210_000);

    // Register so AppContext's SSE handler can resolve this promise
    pendingJobs.set(jobId, {
      resolve: (result) => finish(() => resolve(result)),
      reject: (err) => finish(() => reject(err)),
    });
    localJobIds.add(jobId);

    const checkStatus = async () => {
      if (settled) return;
      try {
        const res = await fetch(`/api/generate/${jobId}`, { cache: "no-store" });
        if (settled) return;
        if (res.status === 404) { finish(() => reject(new Error("Generation lost — please retry"))); return; }
        if (!res.ok) return;
        const job = await res.json();
        if (settled) return;
        if (job.status === "done") {
          const referenceImageDataUrls = Array.isArray(job.referenceImagePaths) && job.referenceImagePaths.length > 0
            ? (job.referenceImagePaths as string[]).map((p: string) => `/api/files/${p}`)
            : undefined;
          finish(() => resolve({ imageId: job.imageId, thumbnailUrl: job.thumbnailUrl, width: job.width, height: job.height, mimeType: job.mimeType, grounded: job.grounded, referenceImageDataUrls }));
        } else if (job.status === "error") {
          finish(() => reject(new Error(job.error || "Generation failed")));
        }
      } catch { /* ignore transient errors — SSE handles the happy path */ }
    };

    // Immediate check: catches jobs that finished before the SSE reconnected (page reload).
    checkStatus();

    // Slow fallback poll every 15s: catches errors/failures the SSE never broadcasts.
    pollHandle = setInterval(() => {
      checkStatus();
    }, 15_000);
  });
}

// Used by the orphan-recovery path in page.tsx to resume a job that survived a page refresh.
// Mark the job as local so the pending_start SSE event doesn't add a duplicate remote shimmer.
export function resumeJob(jobId: string, signal?: AbortSignal): Promise<GenerateResult> {
  localJobIds.add(jobId);
  return waitForJob(jobId, signal);
}

export async function generateImage(
  prompt: string,
  model: ModelId,
  aspectRatio: AspectRatio,
  images?: AttachedImage[],
  quality?: string,
  signal?: AbortSignal,
  searchGrounding?: boolean,
  workspaceId?: string,
  isShared?: boolean,
  selectedAspectRatio?: AspectRatio,
  onJobId?: (jobId: string) => void
): Promise<GenerateResult> {
  // Generate a clientId and register it BEFORE the POST so that if the SSE
  // pending_start event arrives before the fetch response (common on localhost),
  // the originating tab still suppresses the duplicate remote shimmer.
  const clientId = crypto.randomUUID();
  localJobIds.add(clientId);

  let startRes: Response;
  try {
    startRes = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, model, aspectRatio, selectedAspectRatio, images, quality, searchGrounding, workspaceId, isShared, clientId }),
      signal,
    });
  } catch (err) {
    localJobIds.delete(clientId);
    throw err;
  }

  if (!startRes.ok) {
    localJobIds.delete(clientId);
    const err = await startRes.json().catch(() => ({}));
    throw new Error(err?.error || `Generation failed (${startRes.status})`);
  }

  const { jobId } = await startRes.json();
  onJobId?.(jobId);

  addPendingJob({
    jobId,
    prompt,
    model,
    aspectRatio,
    quality: (quality ?? "2K") as Quality,
    workspaceId: workspaceId ?? "",
    searchGrounding,
    startedAt: Date.now(),
  });

  try {
    const result = await waitForJob(jobId, signal);
    if (searchGrounding) {
      console.log("[HomeField] Search grounding:", result.grounded ? "active" : "not triggered");
    }
    return result;
  } finally {
    localJobIds.delete(clientId);
    removePendingJob(jobId);
  }
}
