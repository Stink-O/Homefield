import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { images, workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";
import crypto from "crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const { targetWorkspaceId } = await req.json() as { targetWorkspaceId: string };

  const source = await db.query.images.findFirst({
    where: eq(images.id, id),
  });
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (source.userId !== auth.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (targetWorkspaceId) {
    const ws = await db.query.workspaces.findFirst({
      where: (w, { and, eq }) => and(eq(w.id, targetWorkspaceId), eq(w.userId, auth.userId)),
    });
    if (!ws) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Create a new DB record pointing to the same file on disk (no file copy needed)
  const newId = crypto.randomUUID();
  await db.insert(images).values({
    ...source,
    id: newId,
    workspaceId: targetWorkspaceId,
    timestamp: Date.now(),
  });

  return NextResponse.json({ id: newId }, { status: 201 });
}
