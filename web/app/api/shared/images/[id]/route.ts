import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { images } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";
import { deleteImageFile } from "@/lib/fileStorage";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  const image = await db.query.images.findFirst({
    where: and(eq(images.id, id), eq(images.isShared, true)),
  });
  if (!image) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only the owner or an admin can delete
  if (image.userId !== auth.userId && auth.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await deleteImageFile(image.filePath, image.thumbnailPath ?? null);
  await db.delete(images).where(eq(images.id, id));

  return NextResponse.json({ success: true });
}
