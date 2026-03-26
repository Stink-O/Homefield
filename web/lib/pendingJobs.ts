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
  localStorage.setItem(KEY, JSON.stringify(entries));
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

function saveFailed(entries: FailedJobEntry[]): void {
  localStorage.setItem(FAILED_KEY, JSON.stringify(entries));
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
