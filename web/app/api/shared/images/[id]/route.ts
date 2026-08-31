import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { images } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";
import { deleteImageAssets } from "@/lib/fileStorage";

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

  // deleteImageAssets excludes this row from its own refcount, so the file is
  // unlinked only when no other row (a copy, or the private original) still
  // points at it. Publishing reuses the source file rather than copying it.
  await deleteImageAssets(image);
  await db.delete(images).where(eq(images.id, id));

  return NextResponse.json({ success: true });
}
