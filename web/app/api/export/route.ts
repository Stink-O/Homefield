import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workspaces, images } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";
import fs from "fs/promises";
import path from "path";
import JSZip from "jszip";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const userWorkspaces = await db.select().from(workspaces)
    .where(eq(workspaces.userId, auth.userId));

  const userImages = await db.select().from(images)
    .where(eq(images.userId, auth.userId));

  const zip = new JSZip();
  const projectRoot = path.resolve(process.cwd(), "..");

  const imagesMeta = [];
  for (const img of userImages) {
    try {
      const absPath = path.join(projectRoot, img.filePath.replace(/\//g, path.sep));
      const buffer = await fs.readFile(absPath);
      const ext = path.extname(img.filePath);
      zip.file(`images/${img.id}${ext}`, buffer);
      imagesMeta.push({
        id: img.id,
        workspaceId: img.workspaceId ?? null,
        prompt: img.prompt,
        model: img.model,
        aspectRatio: img.aspectRatio,
        selectedAspectRatio: img.selectedAspectRatio ?? null,
        quality: img.quality ?? null,
        width: img.width,
        height: img.height,
        mimeType: img.mimeType,
        timestamp: img.timestamp,
        searchGrounding: img.searchGrounding ?? null,
        fileExt: ext,
      });
    } catch {
      // Skip images with missing files on disk
    }
  }

  zip.file("manifest.json", JSON.stringify({
    version: 1,
    exportedAt: Date.now(),
    workspaces: userWorkspaces.map((w) => ({ id: w.id, name: w.name, createdAt: w.createdAt })),
    images: imagesMeta,
  }));

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  return new NextResponse(zipBuffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="homefield-export.zip"',
    },
  });
}
