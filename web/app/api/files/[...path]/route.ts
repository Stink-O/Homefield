import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/authHelpers";
import { db } from "@/lib/db";
import { images } from "@/lib/db/schema";
import { and, eq, or, sql } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";

/**
 * Is this stored path readable by this user?
 *
 * Authentication alone is not enough: stored paths are predictable
 * (`storage/images/<ownerId>/<imageId>.png`), so any signed-in account could
 * otherwise read every other account's library by guessing ids.
 *
 * The owning directory is the fast path. The slow path exists because
 * publishing to the shared gallery does NOT copy the file — it inserts a second
 * row pointing at the original owner's path (see api/images/[id]/share). So a
 * shared image legitimately lives under someone else's directory, and the only
 * way to know it is shared is to ask the database.
 */
async function canRead(relativePath: string, userId: string): Promise<boolean> {
  // storage/<kind>/<ownerId>/...
  const segments = relativePath.split("/");
  const ownerSegment = segments[2];

  if (ownerSegment === userId) return true;
  // Generations broadcast to the shared space are written under "shared".
  if (ownerSegment === "shared") return true;

  // Otherwise the file is only readable if some shared row points at it.
  //
  // The LIKE needs an explicit ESCAPE clause: reference filenames contain "_",
  // which is a LIKE wildcard, and escaping it without declaring the escape
  // character makes the pattern match nothing at all.
  const escaped = relativePath.replace(/[\\%_]/g, (c) => `\\${c}`);
  const shared = await db.query.images.findFirst({
    columns: { id: true },
    where: and(
      eq(images.isShared, true),
      or(
        eq(images.filePath, relativePath),
        eq(images.thumbnailPath, relativePath),
        // Reference thumbnails shown in the shared lightbox live inside a JSON
        // array on the row rather than in a column of their own.
        sql`${images.referenceImagePaths} LIKE ${`%${escaped}%`} ESCAPE '\\'`,
      ),
    ),
  });
  return !!shared;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { path: pathSegments } = await params;
  const relativePath = pathSegments.join("/");

  // Security: resolve relative paths from the project root (HomeField/).
  // Stored paths are relative to that root (e.g. "storage/images/…").
  // Guard: reject anything that doesn't resolve inside storage/ — this is the
  // primary defence against path traversal regardless of what's in relativePath.
  const projectRoot = path.resolve(process.cwd(), "..");
  const storageRoot = path.join(projectRoot, "storage");
  const absPath = path.resolve(projectRoot, relativePath.replace(/\//g, path.sep));

  if (!absPath.startsWith(storageRoot + path.sep) && absPath !== storageRoot) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Traversal is handled above; this is the separate question of whose file it
  // is. 404 rather than 403 so the response does not confirm the file exists.
  if (!(await canRead(relativePath, auth.userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(absPath);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = path.extname(absPath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
  };
  const contentType = mimeTypes[ext] ?? "application/octet-stream";

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
