import { NextRequest, NextResponse } from "next/server";
import { getMusicJob } from "@/lib/musicJobs";
import { requireAuth } from "@/lib/authHelpers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

      const initial = getMusicJob(id);
      if (!initial) {
        send({ status: "not_found" });
        controller.close();
        return;
      }
      if (initial.status !== "pending") {
        send({ status: initial.status, track: initial.track, error: initial.error });
        controller.close();
        return;
      }

      // Poll until resolved — slightly beyond the Lyria timeout
      const deadline = Date.now() + 260_000;
      while (!cancelled) {
        await new Promise((r) => setTimeout(r, 750));
        if (cancelled) break;
        if (Date.now() > deadline) {
          send({ status: "error", error: "Generation timed out" });
          controller.close();
          return;
        }
        const job = getMusicJob(id);
        if (!job) {
          send({ status: "not_found" });
          controller.close();
          return;
        }
        if (job.status !== "pending") {
          send({ status: job.status, track: job.track, error: job.error });
          controller.close();
          return;
        }
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
