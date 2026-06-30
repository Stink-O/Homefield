import type { ModelId, AspectRatio, Quality, AttachedImage } from "./types";

export interface PendingJobEntry {
  jobId: string;
  prompt: string;
  model: ModelId;
  aspectRatio: AspectRatio;
  quality: Quality;
  workspaceId: string;
  searchGrounding?: boolean;
  images?: AttachedImage[];
  startedAt: number;
  failed?: boolean;
  errorMessage?: string;
}

const KEY = "hf_pending_jobs";

function load(): PendingJobEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function save(entries: PendingJobEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Best-effort — pending-job persistence (refresh/crash recovery) isn't critical to app function.
  }
}

export function addPendingJob(entry: PendingJobEntry): void {
  const entries = load();
  save([...entries.filter((e) => e.jobId !== entry.jobId), entry]);
}

export function removePendingJob(jobId: string): void {
  save(load().filter((e) => e.jobId !== jobId));
}

export function getPendingJobs(): PendingJobEntry[] {
  return load();
}

export interface FailedJobEntry {
  id: string;
  prompt: string;
  model: ModelId;
  aspectRatio: string;
  selectedAspectRatio?: string;
  quality: Quality;
  workspaceId: string;
  searchGrounding?: boolean;
  images?: AttachedImage[];
  errorMessage: string;
  failedAt: number;
}

// Max total base64 size for reference images stored in localStorage.
// Keeps well within the typical 5-10 MB localStorage budget.
const MAX_IMAGES_STORAGE_BYTES = 2 * 1024 * 1024;

export function trimImagesForStorage(images: AttachedImage[] | undefined): AttachedImage[] | undefined {
  if (!images || images.length === 0) return undefined;
  let total = 0;
  const kept: AttachedImage[] = [];
  for (const img of images) {
    total += img.base64.length;
    if (total > MAX_IMAGES_STORAGE_BYTES) break;
    kept.push(img);
  }
  return kept.length > 0 ? kept : undefined;
}

const FAILED_KEY = "hf_failed_jobs";
const FAILED_TTL_MS = 24 * 60 * 60 * 1000;

function loadFailed(): FailedJobEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(FAILED_KEY) ?? "[]") as FailedJobEntry[];
    const cutoff = Date.now() - FAILED_TTL_MS;
    return raw.filter((e) => e.failedAt > cutoff);
  } catch {
    return [];
  }
}

// Reference images dominate entry size, and the 24h TTL alone doesn't bound how many
// failed entries can accumulate within that window — cap total entries, and only keep
// images on the most recent few so a burst of failures can't blow the storage quota.
const MAX_FAILED_JOBS = 15;
const MAX_FAILED_JOBS_WITH_IMAGES = 3;

function pruneFailedForStorage(entries: FailedJobEntry[]): FailedJobEntry[] {
  const capped = [...entries].sort((a, b) => a.failedAt - b.failedAt).slice(-MAX_FAILED_JOBS);
  const imageCutoff = capped.length - MAX_FAILED_JOBS_WITH_IMAGES;
  return capped.map((e, i) => (i < imageCutoff ? { ...e, images: undefined } : e));
}

function saveFailed(entries: FailedJobEntry[]): void {
  const pruned = pruneFailedForStorage(entries);
  try {
    localStorage.setItem(FAILED_KEY, JSON.stringify(pruned));
  } catch {
    // Still over quota — drop all images and keep only the newest entry.
    try {
      const last = pruned[pruned.length - 1];
      localStorage.setItem(FAILED_KEY, JSON.stringify(last ? [{ ...last, images: undefined }] : []));
    } catch {
      // localStorage is unusable (private browsing, quota exhausted elsewhere) — give up silently.
    }
  }
}

export function addFailedJob(entry: FailedJobEntry): void {
  const entries = loadFailed();
  saveFailed([...entries.filter((e) => e.id !== entry.id), entry]);
}

export function removeFailedJob(id: string): void {
  saveFailed(loadFailed().filter((e) => e.id !== id));
}

export function getFailedJobs(): FailedJobEntry[] {
  return loadFailed();
}
