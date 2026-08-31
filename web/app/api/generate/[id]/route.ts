import { NextRequest, NextResponse } from "next/server";
import { getJobForUser, failJob, abortJob } from "@/lib/jobs";
import { clearSharedPending } from "@/lib/sharedPending";
import { requireAuth } from "@/lib/authHelpers";

// Both verbs answer 404 — not 403 — when the caller does not own the job, so a
// job id is never confirmed to somebody it does not belong to. A job with no
// recorded owner is unreachable here rather than public.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const job = getJobForUser(id, auth.userId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json(job, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const job = getJobForUser(id, auth.userId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Abort the in-flight Vertex AI call so the server stops processing immediately.
  abortJob(id);
  failJob(id, "Cancelled");
  // Clear immediately so a concurrent refresh doesn't restore the shimmer.
  clearSharedPending(id);
  return NextResponse.json({ ok: true });
}
