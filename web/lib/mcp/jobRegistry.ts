// Which agent key started which generation job.
//
// lib/jobs.ts now records the owning *user* and getJobForUser enforces it, so
// this is not the only ownership check — it is the finer one. A user may drive
// generations from the browser and from several keys at once, and a key has no
// business reporting on or cancelling work it did not start. This narrows
// visibility from "anything this account started" to "anything this key
// started"; both checks are applied together.
//
// In-memory and per-process, exactly like lib/jobs.ts: a restart forgets both
// the job and this record together, so they cannot disagree.

export interface AgentJobOwner {
  keyId: string;
  userId: string;
  imageId: string;
  startedAt: number;
}

const JOB_TTL_MS = 2 * 60 * 60 * 1000; // matches the completed-job TTL in lib/jobs.ts

declare global {

  var __hf_agent_jobs: Map<string, AgentJobOwner> | undefined;
}
if (!globalThis.__hf_agent_jobs) {
  globalThis.__hf_agent_jobs = new Map<string, AgentJobOwner>();
}
const agentJobs = globalThis.__hf_agent_jobs;

function prune(now: number): void {
  for (const [id, owner] of agentJobs) {
    if (now - owner.startedAt > JOB_TTL_MS) agentJobs.delete(id);
  }
}

export function rememberAgentJob(jobId: string, owner: AgentJobOwner): void {
  prune(owner.startedAt);
  agentJobs.set(jobId, owner);
}

/**
 * Returns the job's owner record only if this user started it. A job belonging
 * to someone else — or to the browser UI — is reported as unknown.
 */
export function lookupAgentJob(jobId: string, userId: string): AgentJobOwner | null {
  const owner = agentJobs.get(jobId);
  if (!owner || owner.userId !== userId) return null;
  return owner;
}

export function forgetAgentJob(jobId: string): void {
  agentJobs.delete(jobId);
}
