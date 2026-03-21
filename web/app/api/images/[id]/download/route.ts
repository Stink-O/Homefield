import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { images } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";
import fs from "fs/promises";
import path from "path";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  // Allow accessing private images (owner only) or shared images (any authenticated user)
  const image = await db.query.images.findFirst({
    where: eq(images.id, id),
  });

  if (!image) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!image.isShared && image.userId !== auth.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const root = path.join(process.cwd(), "..");
  const absPath = path.join(root, image.filePath.replace(/\//g, path.sep));

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(absPath);
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": image.mimeType,
      "Content-Disposition": `attachment; filename="${image.id}.${image.mimeType === "image/jpeg" ? "jpg" : "png"}"`,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
