import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { images, workspaces } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";
import crypto from "crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const { workspaceId } = await req.json() as { workspaceId: string };
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const source = await db.query.images.findFirst({
    where: and(eq(images.id, id), eq(images.isShared, true)),
  });
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (workspaceId) {
    const ws = await db.query.workspaces.findFirst({
      where: (w, { and, eq }) => and(eq(w.id, workspaceId), eq(w.userId, auth.userId)),
    });
    if (!ws) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const newId = crypto.randomUUID();
  await db.insert(images).values({
    ...source,
    id: newId,
    userId: auth.userId,
    workspaceId,
    isShared: false,
    timestamp: Date.now(),
  });

  return NextResponse.json({ id: newId }, { status: 201 });
}
