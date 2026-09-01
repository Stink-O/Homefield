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
 * Returns the job's owner record only if THIS key started it.
 *
 * Matching on the user alone would let one key report on, and cancel, work
 * started by another key or from the browser — including generations outside
 * its own workspace. The key id is the whole point of storing this.
 */
export function lookupAgentJob(jobId: string, keyId: string, userId: string): AgentJobOwner | null {
  const owner = agentJobs.get(jobId);
  if (!owner || owner.userId !== userId || owner.keyId !== keyId) return null;
  return owner;
}

export function forgetAgentJob(jobId: string): void {
  agentJobs.delete(jobId);
}

/**
 * Every job this key still has in flight.
 *
 * Used when a key is revoked. "Revoke" has to mean the agent stops, not merely
 * that its next call is refused — a queued batch would otherwise run to
 * completion and bill the owner after they had already pulled the plug.
 */
export function liveJobsForKey(keyId: string): string[] {
  const out: string[] = [];
  for (const [jobId, owner] of agentJobs) {
    if (owner.keyId === keyId) out.push(jobId);
  }
  return out;
}
