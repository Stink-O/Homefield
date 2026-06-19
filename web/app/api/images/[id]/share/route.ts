import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { images, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";
import { broadcastShared } from "@/lib/sharedBroadcast";
import crypto from "crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  const source = await db.query.images.findFirst({
    where: eq(images.id, id),
  });
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (source.userId !== auth.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Create a shared copy pointing to the same file on disk (no file copy needed).
  // Shared images are served to any authenticated user via the download/files routes.
  const newId = crypto.randomUUID();
  const timestamp = Date.now();
  await db.insert(images).values({
    ...source,
    id: newId,
    workspaceId: null,
    isShared: true,
    timestamp,
  });

  // Notify anyone viewing the shared space so the image shows up live.
  const owner = await db.query.users.findFirst({
    where: eq(users.id, auth.userId),
  });
  broadcastShared({
    id: newId,
    jobId: newId,
    userId: auth.userId,
    username: owner?.username ?? "",
    prompt: source.prompt,
    model: source.model,
    aspectRatio: source.aspectRatio,
    quality: source.quality ?? null,
    width: source.width,
    height: source.height,
    thumbnailUrl: source.thumbnailPath ? `/api/files/${source.thumbnailPath}` : "",
    timestamp,
    referenceImageDataUrls: source.referenceImagePaths
      ? (() => { try { return (JSON.parse(source.referenceImagePaths!) as string[]).map((p) => `/api/files/${p}`); } catch { return undefined; } })()
      : undefined,
  });

  return NextResponse.json({ id: newId }, { status: 201 });
}
