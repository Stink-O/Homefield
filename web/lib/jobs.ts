export type JobStatus = "pending" | "done" | "error";

export interface Job {
  status: JobStatus;
  // Resolved result fields (replaces base64 — image is saved to disk server-side)
  imageId?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  grounded?: boolean;
  referenceImagePaths?: string[];
  error?: string;
  createdAt: number;
}

// Use global singletons so Maps are shared across Next.js route bundles
// (each API route gets its own module instance otherwise).
declare global {
  // eslint-disable-next-line no-var
  var __hf_jobs: Map<string, Job> | undefined;
  // eslint-disable-next-line no-var
  var __hf_jobs_gc: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __hf_job_aborts: Map<string, () => void> | undefined;
}

if (!globalThis.__hf_jobs) {
  globalThis.__hf_jobs = new Map<string, Job>();
}
if (!globalThis.__hf_job_aborts) {
  globalThis.__hf_job_aborts = new Map<string, () => void>();
}
if (!globalThis.__hf_jobs_gc) {
  globalThis.__hf_jobs_gc = setInterval(() => {
    const now = Date.now();
    for (const [id, job] of globalThis.__hf_jobs!.entries()) {
      const age = now - job.createdAt;
      // Pending jobs abandoned after 15 min (covers even very slow generations)
      // Completed/failed results kept for 2 hours so mobile clients can retrieve
      // them after returning from background or a full page reload
      const ttl = job.status === "pending" ? 15 * 60 * 1000 : 2 * 60 * 60 * 1000;
      if (age > ttl) globalThis.__hf_jobs!.delete(id);
    }
  }, 60 * 1000);
}

const jobs = globalThis.__hf_jobs;
const jobAborts = globalThis.__hf_job_aborts;

export function registerJobAbort(id: string, abort: () => void): void {
  jobAborts!.set(id, abort);
}

export function abortJob(id: string): void {
  jobAborts!.get(id)?.();
  jobAborts!.delete(id);
}

export function unregisterJobAbort(id: string): void {
  jobAborts!.delete(id);
}

export function createJob(id: string): void {
  jobs.set(id, { status: "pending", createdAt: Date.now() });
}

export function resolveJob(id: string, result: { imageId: string; thumbnailUrl: string; width: number; height: number; mimeType: string; grounded?: boolean; referenceImagePaths?: string[] }): void {
  const job = jobs.get(id);
  if (!job) return;
  jobs.set(id, { ...job, status: "done", ...result });
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id);
  if (!job) return;
  jobs.set(id, { ...job, status: "error", error });
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}
