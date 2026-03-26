export type MusicJobStatus = "pending" | "done" | "error";

export interface MusicJobTrack {
  id: string;
  prompt: string;
  model: string;
  filePath: string;
  mimeType: string;
  timestamp: number;
  lyrics?: string | null;
  description?: string | null;
}

export interface MusicJob {
  status: MusicJobStatus;
  track?: MusicJobTrack;
  error?: string;
  createdAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __hf_music_jobs: Map<string, MusicJob> | undefined;
  // eslint-disable-next-line no-var
  var __hf_music_job_aborts: Map<string, () => void> | undefined;
  // eslint-disable-next-line no-var
  var __hf_music_jobs_gc: ReturnType<typeof setInterval> | undefined;
}

if (!globalThis.__hf_music_jobs) globalThis.__hf_music_jobs = new Map<string, MusicJob>();
if (!globalThis.__hf_music_job_aborts) globalThis.__hf_music_job_aborts = new Map<string, () => void>();
if (!globalThis.__hf_music_jobs_gc) {
  globalThis.__hf_music_jobs_gc = setInterval(() => {
    const now = Date.now();
    for (const [id, job] of globalThis.__hf_music_jobs!.entries()) {
      const ttl = job.status === "pending" ? 15 * 60 * 1000 : 2 * 60 * 60 * 1000;
      if (now - job.createdAt > ttl) globalThis.__hf_music_jobs!.delete(id);
    }
  }, 60_000);
}

const musicJobs = globalThis.__hf_music_jobs;
const musicJobAborts = globalThis.__hf_music_job_aborts;

export function createMusicJob(id: string): void {
  musicJobs.set(id, { status: "pending", createdAt: Date.now() });
}

export function resolveMusicJob(id: string, track: MusicJobTrack): void {
  const job = musicJobs.get(id);
  if (!job) return;
  musicJobs.set(id, { ...job, status: "done", track });
}

export function failMusicJob(id: string, error: string): void {
  const job = musicJobs.get(id);
  if (!job) return;
  musicJobs.set(id, { ...job, status: "error", error });
}

export function getMusicJob(id: string): MusicJob | undefined {
  return musicJobs.get(id);
}

export function registerMusicJobAbort(id: string, abort: () => void): void {
  musicJobAborts!.set(id, abort);
}

export function unregisterMusicJobAbort(id: string): void {
  musicJobAborts!.delete(id);
}
