import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { images, users } from "@/lib/db/schema";
import { eq, lt, desc } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = req.nextUrl;
  const cursorParam = searchParams.get("cursor");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "30", 10), 100);
  const cursor = cursorParam ? parseInt(cursorParam, 10) : undefined;

  const results = await db
    .select({
      id: images.id,
      userId: images.userId,
      username: users.username,
      prompt: images.prompt,
      model: images.model,
      aspectRatio: images.aspectRatio,
      selectedAspectRatio: images.selectedAspectRatio,
      quality: images.quality,
      width: images.width,
      height: images.height,
      thumbnailPath: images.thumbnailPath,
      mimeType: images.mimeType,
      timestamp: images.timestamp,
      searchGrounding: images.searchGrounding,
      referenceImagePaths: images.referenceImagePaths,
    })
    .from(images)
    .innerJoin(users, eq(images.userId, users.id))
    .where(
      cursor !== undefined
        ? eq(images.isShared, true) && lt(images.timestamp, cursor)
        : eq(images.isShared, true)
    )
    .orderBy(desc(images.timestamp))
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const items = results.slice(0, limit).map((img) => ({
    ...img,
    thumbnailUrl: img.thumbnailPath ? `/api/files/${img.thumbnailPath}` : null,
    thumbnailPath: undefined,
    referenceImageDataUrls: img.referenceImagePaths
      ? (() => { try { return (JSON.parse(img.referenceImagePaths!) as string[]).map((p) => `/api/files/${p}`); } catch { return undefined; } })()
      : undefined,
    referenceImagePaths: undefined,
  }));

  return NextResponse.json({ items, hasMore });
}
