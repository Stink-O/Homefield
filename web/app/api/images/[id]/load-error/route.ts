import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/authHelpers";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const type: string = body.type ?? "unknown";

  console.error(`[ImageLoad] Client reported load failure: id=${id}, type=${type}, userId=${auth.userId}`);

  return NextResponse.json({ ok: true });
}
