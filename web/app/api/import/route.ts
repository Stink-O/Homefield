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

async function importImage(
  imgMeta: ManifestImage,
  zip: JSZip,
  userId: string,
  workspaceIdMap: Map<string, string>,
): Promise<boolean> {
  const imgFile = zip.file(`images/${imgMeta.id}${imgMeta.fileExt}`);
  if (!imgFile) return false;

  const newId = crypto.randomUUID();
  const base64 = await imgFile.async("base64");

  const { filePath, thumbnailPath, width, height } = await saveImageFile(
    userId,
    newId,
    base64,
    imgMeta.mimeType,
  );

  const newWorkspaceId = imgMeta.workspaceId
    ? (workspaceIdMap.get(imgMeta.workspaceId) ?? null)
    : null;

  await db.insert(images).values({
    id: newId,
    userId,
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

  return true;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let zip: JSZip;
  try {
    const buffer = Buffer.from(await req.arrayBuffer());
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return NextResponse.json({ error: "Invalid or corrupt ZIP file. The file may be too large or damaged." }, { status: 400 });
  }

  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    return NextResponse.json({ error: "Missing manifest.json — this does not appear to be a HomeField export." }, { status: 400 });
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(await manifestFile.async("string")) as Manifest;
  } catch {
    return NextResponse.json({ error: "manifest.json could not be parsed." }, { status: 400 });
  }

  if (!manifest.version || !Array.isArray(manifest.workspaces) || !Array.isArray(manifest.images)) {
    return NextResponse.json({ error: "Unrecognised manifest format." }, { status: 400 });
  }

  // Create workspaces, mapping old IDs to new ones
  const workspaceIdMap = new Map<string, string>();
  for (const ws of manifest.workspaces) {
    const newId = crypto.randomUUID();
    workspaceIdMap.set(ws.id, newId);
    await db.insert(workspaces).values({
      id: newId,
      userId: auth.userId,
      name: `${ws.name} (Imported)`,
      createdAt: ws.createdAt,
    });
  }

  // Import images in parallel batches of 5 to balance speed vs. memory
  const BATCH = 5;
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < manifest.images.length; i += BATCH) {
    const batch = manifest.images.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map((imgMeta) => importImage(imgMeta, zip, auth.userId, workspaceIdMap))
    );
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        imported++;
      } else {
        skipped++;
      }
    }
  }

  return NextResponse.json({
    success: true,
    imported,
    skipped,
    workspaces: manifest.workspaces.length,
  });
}
