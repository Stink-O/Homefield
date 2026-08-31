// Revoke one agent key. Session-authenticated, owner-scoped.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/authHelpers";
import { revokeAgentKey } from "@/lib/agent/keys";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Scoped by userId inside revokeAgentKey, so a valid id belonging to someone
  // else is indistinguishable from one that does not exist.
  const revoked = await revokeAgentKey(auth.userId, id);
  if (!revoked) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
