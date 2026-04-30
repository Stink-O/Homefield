import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { images } from "@/lib/db/schema";
import { eq, and, lt, desc, isNull } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = req.nextUrl;
  const workspaceId = searchParams.get("workspaceId");
  const cursorParam = searchParams.get("cursor");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "30", 10), 100);
  const cursor = cursorParam ? parseInt(cursorParam, 10) : undefined;

  // "main" and omitted both mean the NULL workspace in the database.
  // "all" skips the workspace filter entirely (used by For You to read across all workspaces).
  const isAll  = workspaceId === "all";
  const isMain = !workspaceId || workspaceId === "main";
  const conditions = [
    eq(images.userId, auth.userId),
    eq(images.isShared, false),
    ...(isAll ? [] : [isMain ? isNull(images.workspaceId) : eq(images.workspaceId, workspaceId!)]),
  ];
  if (cursor !== undefined) conditions.push(lt(images.timestamp, cursor));

  const results = await db.select({
    id: images.id,
    userId: images.userId,
    workspaceId: images.workspaceId,
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
  }).from(images)
    .where(and(...conditions))
    .orderBy(desc(images.timestamp))
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const items = results.slice(0, limit).map((img) => ({
    ...img,
    thumbnailUrl: img.thumbnailPath ? `/api/files/${img.thumbnailPath}` : null,
    referenceImageDataUrls: img.referenceImagePaths
      ? (() => { try { return (JSON.parse(img.referenceImagePaths!) as string[]).map((p) => `/api/files/${p}`); } catch { return undefined; } })()
      : undefined,
  }));

  return NextResponse.json({ items, hasMore });
}
