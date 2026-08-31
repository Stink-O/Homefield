import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { images } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";
import { deleteImageAssets } from "@/lib/fileStorage";
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

  // Drop the row first, then the files. Publishing/copying/saving-from-shared
  // reuse the same file for several rows, so deleteImageAssets only unlinks what
  // nothing else points at any more.
  await db.delete(images).where(eq(images.id, id));
  await deleteImageAssets(image);
  broadcastImageDelete(auth.userId, id);

  return NextResponse.json({ success: true });
}
