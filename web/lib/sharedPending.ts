export interface SharedPendingJob {
  jobId: string;
  prompt: string;
  aspectRatio: string;
  startedAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __hf_shared_pending: Map<string, SharedPendingJob> | undefined;
}

if (!globalThis.__hf_shared_pending) {
  globalThis.__hf_shared_pending = new Map();
}

export function registerSharedPending(job: SharedPendingJob): void {
  globalThis.__hf_shared_pending!.set(job.jobId, job);
}

export function clearSharedPending(jobId: string): void {
  globalThis.__hf_shared_pending!.delete(jobId);
}

export function getSharedPending(): SharedPendingJob[] {
  return Array.from(globalThis.__hf_shared_pending!.values());
}
