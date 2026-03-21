import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workspaces, images } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";
import { deleteImageFile, deleteReferenceImages } from "@/lib/fileStorage";

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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  // Delete all images in this workspace from disk
  const workspaceImages = await db.select().from(images)
    .where(and(eq(images.workspaceId, id), eq(images.userId, auth.userId)));

  for (const img of workspaceImages) {
    await deleteImageFile(img.filePath, img.thumbnailPath ?? null);
    if (img.referenceImagePaths) {
      const ownerId = img.filePath.split("/")[2];
      await deleteReferenceImages(ownerId, img.id);
    }
  }

  // Cascade handles DB deletion of images and workspace
  await db.delete(workspaces)
    .where(and(eq(workspaces.id, id), eq(workspaces.userId, auth.userId)));

  return NextResponse.json({ success: true, movedToMain: workspaceImages.length });
}
