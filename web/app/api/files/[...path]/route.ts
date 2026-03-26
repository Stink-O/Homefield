import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/authHelpers";
import fs from "fs/promises";
import path from "path";

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
