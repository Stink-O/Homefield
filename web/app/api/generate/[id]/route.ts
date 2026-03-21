import { NextRequest, NextResponse } from "next/server";
import { getJob, failJob, abortJob } from "@/lib/jobs";
import { clearSharedPending } from "@/lib/sharedPending";
import { requireAuth } from "@/lib/authHelpers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json(job, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  // Abort the in-flight Vertex AI call so the server stops processing immediately.
  abortJob(id);
  failJob(id, "Cancelled");
  // Clear immediately so a concurrent refresh doesn't restore the shimmer.
  clearSharedPending(id);
  return NextResponse.json({ ok: true });
}
