import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { images } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";
import { deleteImageFile, deleteReferenceImages } from "@/lib/fileStorage";
import { broadcastImageDelete } from "@/lib/imageBroadcast";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  const image = await db.query.images.findFirst({
    where: and(eq(images.id, id), eq(images.userId, auth.userId)),
  });
  if (!image) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await deleteImageFile(image.filePath, image.thumbnailPath ?? null);
  if (image.referenceImagePaths) {
    const ownerId = image.filePath.split("/")[2]; // storage/images/<ownerId>/...
    await deleteReferenceImages(ownerId, id);
  }
  await db.delete(images).where(eq(images.id, id));
  broadcastImageDelete(auth.userId, id);

  return NextResponse.json({ success: true });
}
