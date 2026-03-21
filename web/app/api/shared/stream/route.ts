import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/authHelpers";
import { NextResponse } from "next/server";
import { subscribeToShared, type SharedStreamEvent } from "@/lib/sharedBroadcast";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const encoder = new TextEncoder();

  const body = new ReadableStream({
    start(controller) {
      // Send a keep-alive comment immediately so the client knows the connection is live
      controller.enqueue(encoder.encode(": connected\n\n"));

      const unsubscribe = subscribeToShared((event: SharedStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Controller may be closed; ignore
        }
      });

      // Keep-alive ping every 25s to prevent proxy timeouts
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(ping);
        }
      }, 25_000);

      // Cleanup on client disconnect
      _req.signal.addEventListener("abort", () => {
        clearInterval(ping);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      }, { once: true });
    },
    cancel() {
      // ReadableStream cancel — already handled by abort listener above
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
