import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workspaces, images } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";
import { deleteImageAssets } from "@/lib/fileStorage";
import { broadcastImageDelete } from "@/lib/imageBroadcast";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const { name } = await req.json() as { name: string };
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  await db.update(workspaces)
    .set({ name: name.trim() })
    .where(and(eq(workspaces.id, id), eq(workspaces.userId, auth.userId)));

  return NextResponse.json({ success: true });
}

/**
 * Deletes a workspace and everything in it.
 *
 * images.workspace_id is ON DELETE SET NULL, so dropping the workspace row does
 * NOT remove its images — they reappear in the user's Main workspace, and before
 * this route deleted them explicitly their files were already gone, so Main
 * filled up with broken thumbnails. The UI promises "permanently delete the
 * workspace and N generated images", so the rows go too.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  const workspace = await db.query.workspaces.findFirst({
    where: and(eq(workspaces.id, id), eq(workspaces.userId, auth.userId)),
  });
  if (!workspace) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const scope = and(eq(images.workspaceId, id), eq(images.userId, auth.userId));
  const workspaceImages = await db.select().from(images).where(scope);

  // Rows first, then files: with every row gone the reference count is exact,
  // including two rows in this same workspace that share one file. Files still
  // pointed at by a copy elsewhere (or by a published/shared row) survive.
  await db.delete(images).where(scope);
  for (const img of workspaceImages) {
    await deleteImageAssets(img);
    broadcastImageDelete(auth.userId, img.id);
  }

  await db.delete(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.userId, auth.userId)));

  return NextResponse.json({ success: true, deletedImages: workspaceImages.length });
}
