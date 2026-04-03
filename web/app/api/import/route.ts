import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workspaces, images } from "@/lib/db/schema";
import { requireAuth } from "@/lib/authHelpers";
import { saveImageFile } from "@/lib/fileStorage";
import JSZip from "jszip";
import crypto from "crypto";

interface ManifestWorkspace {
  id: string;
  name: string;
  createdAt: number;
}

interface ManifestImage {
  id: string;
  workspaceId: string | null;
  prompt: string;
  model: string;
  aspectRatio: string;
  selectedAspectRatio?: string | null;
  quality?: string | null;
  width: number;
  height: number;
  mimeType: string;
  timestamp: number;
  searchGrounding?: boolean | null;
  fileExt: string;
}

interface Manifest {
  version: number;
  workspaces: ManifestWorkspace[];
  images: ManifestImage[];
}

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let zip: JSZip;
  try {
    const buffer = Buffer.from(await req.arrayBuffer());
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return NextResponse.json({ error: "Invalid ZIP file" }, { status: 400 });
  }

  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    return NextResponse.json({ error: "Missing manifest" }, { status: 400 });
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(await manifestFile.async("string")) as Manifest;
  } catch {
    return NextResponse.json({ error: "Invalid manifest" }, { status: 400 });
  }

  if (!manifest.version || !Array.isArray(manifest.workspaces) || !Array.isArray(manifest.images)) {
    return NextResponse.json({ error: "Invalid manifest structure" }, { status: 400 });
  }

  // Create each workspace with "(Imported)" appended, track old -> new ID
  const workspaceIdMap = new Map<string, string>();
  for (const ws of manifest.workspaces) {
    const newId = crypto.randomUUID();
    workspaceIdMap.set(ws.id, newId);
    await db.insert(workspaces).values({
      id: newId,
      userId: auth.userId,
      name: `${ws.name} (Imported)`,
      createdAt: Date.now(),
    });
  }

  // Import each image
  let imported = 0;
  for (const imgMeta of manifest.images) {
    const imgFile = zip.file(`images/${imgMeta.id}${imgMeta.fileExt}`);
    if (!imgFile) continue;

    const newId = crypto.randomUUID();
    const base64 = await imgFile.async("base64");

    try {
      const { filePath, thumbnailPath, width, height } = await saveImageFile(
        auth.userId,
        newId,
        base64,
        imgMeta.mimeType,
      );

      const newWorkspaceId = imgMeta.workspaceId
        ? (workspaceIdMap.get(imgMeta.workspaceId) ?? null)
        : null;

      await db.insert(images).values({
        id: newId,
        userId: auth.userId,
        workspaceId: newWorkspaceId,
        prompt: imgMeta.prompt,
        model: imgMeta.model,
        aspectRatio: imgMeta.aspectRatio,
        selectedAspectRatio: imgMeta.selectedAspectRatio ?? null,
        quality: imgMeta.quality ?? null,
        width,
        height,
        filePath,
        thumbnailPath,
        mimeType: imgMeta.mimeType,
        timestamp: imgMeta.timestamp,
        searchGrounding: imgMeta.searchGrounding ?? null,
        isShared: false,
        referenceImagePaths: null,
      });

      imported++;
    } catch {
      // Skip images that fail to save
    }
  }

  return NextResponse.json({ success: true, imported, workspaces: manifest.workspaces.length });
}
