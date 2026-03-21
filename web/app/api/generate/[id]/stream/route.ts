import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";
import { requireAuth } from "@/lib/authHelpers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // OWASP: Broken Access Control — ensure only authenticated users can poll job status.
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;
  const encoder = new TextEncoder();
  let cancelled = false;

  const body = new ReadableStream({
    async start(controller) {
      const send = (payload: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      // If job already has a result, push it immediately and close
      const initial = getJob(id);
      if (!initial) {
        send({ status: "not_found" });
        controller.close();
        return;
      }
      if (initial.status !== "pending") {
        send({ status: initial.status, imageId: initial.imageId, thumbnailUrl: initial.thumbnailUrl, width: initial.width, height: initial.height, mimeType: initial.mimeType, grounded: initial.grounded, referenceImagePaths: initial.referenceImagePaths, error: initial.error });
        controller.close();
        return;
      }

      // Generation still in progress — poll the in-memory Map until it resolves.
      // This loop is server-side so it isn't affected by the client backgrounding.
      const deadline = Date.now() + 210_000; // slightly beyond VERTEX_TIMEOUT_MS
      while (!cancelled) {
        await new Promise((r) => setTimeout(r, 500));
        if (cancelled) break;
        if (Date.now() > deadline) {
          send({ status: "error", error: "Generation timed out" });
          controller.close();
          return;
        }
        const job = getJob(id);
        if (!job) {
          send({ status: "not_found" });
          controller.close();
          return;
        }
        if (job.status !== "pending") {
          send({ status: job.status, imageId: job.imageId, thumbnailUrl: job.thumbnailUrl, width: job.width, height: job.height, mimeType: job.mimeType, grounded: job.grounded, referenceImagePaths: job.referenceImagePaths, error: job.error });
          controller.close();
          return;
        }
      }
    },
    cancel() {
      // Client disconnected — stop the polling loop
      cancelled = true;
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // prevent Nginx/proxy buffering
    },
  });
}
