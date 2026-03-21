import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { images, workspaces } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const { workspaceId } = await req.json() as { workspaceId: string | null };

  if (workspaceId) {
    const ws = await db.query.workspaces.findFirst({
      where: (w, { and, eq }) => and(eq(w.id, workspaceId), eq(w.userId, auth.userId)),
    });
    if (!ws) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.update(images)
    .set({ workspaceId: workspaceId ?? null })
    .where(and(eq(images.id, id), eq(images.userId, auth.userId)));

  return NextResponse.json({ success: true });
}
