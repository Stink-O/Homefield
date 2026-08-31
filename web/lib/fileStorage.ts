import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { and, eq, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { images } from "@/lib/db/schema";

const STORAGE_ROOT = path.join(process.cwd(), "..", "storage", "images");
const TEMPLATE_STORAGE_ROOT = path.join(process.cwd(), "..", "storage", "templates");
const THUMB_MAX_DIM = 1200;

export async function saveImageFile(
  ownerId: string, // userId or "shared"
  imageId: string,
  base64: string,
  mimeType: string
): Promise<{ filePath: string; thumbnailPath: string; width: number; height: number }> {
  const dir = path.join(STORAGE_ROOT, ownerId);
  await fs.mkdir(dir, { recursive: true });

  const ext = mimeType === "image/jpeg" ? "jpg" : "png";
  const fileName = `${imageId}.${ext}`;
  const thumbFileName = `${imageId}.thumb.jpg`;
  const absFilePath = path.join(dir, fileName);
  const absThumbPath = path.join(dir, thumbFileName);

  const buffer = Buffer.from(base64, "base64");
  await fs.writeFile(absFilePath, buffer);

  const image = sharp(buffer);
  const meta = await image.metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;

  const scale = Math.min(1, THUMB_MAX_DIM / Math.max(width, height));
  await image
    .resize(Math.round(width * scale), Math.round(height * scale))
    .jpeg({ quality: 82 })
    .toFile(absThumbPath);

  // Store relative paths from project root (HomeField/)
  const relBase = path.join("storage", "images", ownerId).replace(/\\/g, "/");
  return {
    filePath: `${relBase}/${fileName}`,
    thumbnailPath: `${relBase}/${thumbFileName}`,
    width,
    height,
  };
}

export async function saveReferenceImages(
  ownerId: string,
  imageId: string,
  refImages: { base64: string; mimeType: string }[]
): Promise<string[]> {
  if (refImages.length === 0) return [];
  const dir = path.join(STORAGE_ROOT, ownerId, "refs", imageId);
  await fs.mkdir(dir, { recursive: true });
  const paths: string[] = [];
  for (let i = 0; i < refImages.length; i++) {
    const { base64, mimeType } = refImages[i];
    const ext = mimeType === "image/jpeg" ? "jpg" : "png";
    const fileName = `ref_${i}.${ext}`;
    await fs.writeFile(path.join(dir, fileName), Buffer.from(base64, "base64"));
    paths.push(path.join("storage", "images", ownerId, "refs", imageId, fileName).replace(/\\/g, "/"));
  }
  return paths;
}

// ── Reference counting ───────────────────────────────────────────────────────
//
// Publishing, copying and saving-from-shared all insert a new `images` row that
// spreads `...source`, so several rows legitimately point at the SAME file on
// disk (see app/api/images/[id]/share, .../copy and app/api/shared/images/[id]/save).
// Unlinking on the first delete therefore blanked every other row pointing at
// that file, including other users' saved copies.
//
// The check lives here rather than in the routes so a caller cannot forget it:
// every delete path in the app already funnels through these functions.
//
// Ordering: pass `exceptImageId` when the row is still present (deleting files
// before the row), or delete the row(s) first and call without it. Anything a
// remaining row still points at is left on disk. If the reference query itself
// fails we treat the path as still referenced — leaking a file is recoverable,
// destroying someone else's image is not.

const PROJECT_ROOT = path.join(process.cwd(), "..");

/**
 * Resolves a stored relative path against the project root, refusing anything
 * that escapes it. Stored paths are written by this module, but they round-trip
 * through the database, so deletes validate rather than trust.
 */
function resolveInsideRoot(relPath: string): string | null {
  if (!relPath) return null;
  const root = path.resolve(PROJECT_ROOT);
  const abs = path.resolve(root, relPath.replace(/\//g, path.sep));
  return abs.startsWith(root + path.sep) ? abs : null;
}

function countImages(where: SQL | undefined): number {
  const row = db.select({ n: sql<number>`count(*)` }).from(images).where(where).get();
  return Number(row?.n ?? 0);
}

/** True when an `images` row other than `exceptImageId` still points at `value`. */
function isPathReferenced(
  column: typeof images.filePath | typeof images.thumbnailPath,
  value: string,
  exceptImageId?: string,
): boolean {
  try {
    const match = eq(column, value);
    return countImages(exceptImageId ? and(match, ne(images.id, exceptImageId)) : match) > 0;
  } catch (err) {
    console.error("[fileStorage] reference check failed; keeping file:", err);
    return true;
  }
}

/** Escapes LIKE wildcards so a path is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * True when an `images` row other than `exceptImageId` still lists a reference
 * image inside `relDir`. Reference paths are stored as a JSON array of strings,
 * so this matches the directory prefix inside that JSON.
 */
function isReferenceDirReferenced(relDir: string, exceptImageId?: string): boolean {
  try {
    const pattern = `%${escapeLike(relDir)}/%`;
    const match = sql`${images.referenceImagePaths} LIKE ${pattern} ESCAPE '\\'`;
    return countImages(exceptImageId ? and(match, ne(images.id, exceptImageId)) : match) > 0;
  } catch (err) {
    console.error("[fileStorage] reference check failed; keeping reference images:", err);
    return true;
  }
}

/**
 * The directory holding an image's reference images, derived from the stored
 * paths rather than from the row id. A copied row keeps the ORIGINAL image's
 * reference paths, so deriving the directory from the row's own id would both
 * miss the copy's files and delete the original's out from under it.
 */
function referenceDirFromPaths(referenceImagePathsJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(referenceImagePathsJson);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const first = parsed.find((p): p is string => typeof p === "string" && p.length > 0);
  if (!first) return null;
  const dir = path.posix.dirname(first.replace(/\\/g, "/"));
  return dir.startsWith("storage/images/") && dir.includes("/refs/") ? dir : null;
}

async function removeReferenceDir(relDir: string, exceptImageId?: string): Promise<void> {
  if (isReferenceDirReferenced(relDir, exceptImageId)) return;
  const abs = resolveInsideRoot(relDir);
  if (!abs) return;
  await fs.rm(abs, { recursive: true, force: true }).catch(() => {});
}

/**
 * Removes the reference-image directory for `imageId`, unless another row still
 * points into it. Signature preserved for existing callers.
 */
export async function deleteReferenceImages(
  ownerId: string,
  imageId: string,
  opts?: { exceptImageId?: string },
): Promise<void> {
  await removeReferenceDir(`storage/images/${ownerId}/refs/${imageId}`, opts?.exceptImageId);
}

export async function saveTemplateThumb(
  userId: string,
  templateId: string,
  base64: string,
  mimeType: string
): Promise<string> {
  const dir = path.join(TEMPLATE_STORAGE_ROOT, userId);
  await fs.mkdir(dir, { recursive: true });

  const ext = mimeType === "image/jpeg" ? "jpg" : "png";
  const fileName = `${templateId}.${ext}`;
  const absFilePath = path.join(dir, fileName);

  const buffer = Buffer.from(base64, "base64");
  await fs.writeFile(absFilePath, buffer);

  return `storage/templates/${userId}/${fileName}`;
}

/**
 * Unlinks an image and its thumbnail, but only where no other `images` row still
 * points at them. Pass `exceptImageId` when the row being deleted is still in
 * the database; omit it when the row is already gone.
 */
export async function deleteImageFile(
  filePath: string,
  thumbnailPath: string | null,
  opts?: { exceptImageId?: string },
): Promise<void> {
  const except = opts?.exceptImageId;

  if (!isPathReferenced(images.filePath, filePath, except)) {
    const abs = resolveInsideRoot(filePath);
    if (abs) await fs.unlink(abs).catch(() => {});
  }

  if (thumbnailPath && !isPathReferenced(images.thumbnailPath, thumbnailPath, except)) {
    const abs = resolveInsideRoot(thumbnailPath);
    if (abs) await fs.unlink(abs).catch(() => {});
  }
}

/** The on-disk assets an `images` row points at. */
export interface ImageAssetRefs {
  id: string;
  filePath: string;
  thumbnailPath: string | null;
  referenceImagePaths?: string | null;
}

/**
 * Deletes every file an image row owns — original, thumbnail and reference
 * images — skipping anything another row still points at. This is the entry
 * point delete routes should use: it derives the reference directory from the
 * row's own stored paths, so shared/copied rows are handled correctly.
 */
export async function deleteImageAssets(row: ImageAssetRefs): Promise<void> {
  await deleteImageFile(row.filePath, row.thumbnailPath ?? null, { exceptImageId: row.id });
  if (row.referenceImagePaths) {
    const dir = referenceDirFromPaths(row.referenceImagePaths);
    if (dir) await removeReferenceDir(dir, row.id);
  }
}

export async function deleteTemplateThumb(thumbnailPath: string): Promise<void> {
  const root = path.join(process.cwd(), "..");
  await fs.unlink(path.join(root, thumbnailPath.replace(/\//g, path.sep))).catch(() => {});
}

const AUDIO_STORAGE_ROOT = path.join(process.cwd(), "..", "storage", "audio");

export async function saveAudioFile(
  userId: string,
  trackId: string,
  base64: string,
  mimeType: string
): Promise<string> {
  const dir = path.join(AUDIO_STORAGE_ROOT, userId);
  await fs.mkdir(dir, { recursive: true });
  const ext = mimeType === "audio/wav" ? "wav" : "mp3";
  const fileName = `${trackId}.${ext}`;
  await fs.writeFile(path.join(dir, fileName), Buffer.from(base64, "base64"));
  return `storage/audio/${userId}/${fileName}`;
}

export async function deleteAudioFile(filePath: string): Promise<void> {
  const root = path.join(process.cwd(), "..");
  await fs.unlink(path.join(root, filePath.replace(/\//g, path.sep))).catch(() => {});
}
