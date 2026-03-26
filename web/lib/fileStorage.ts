import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

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

export async function deleteReferenceImages(ownerId: string, imageId: string): Promise<void> {
  const root = path.join(process.cwd(), "..");
  const dir = path.join(root, "storage", "images", ownerId, "refs", imageId);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
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

export async function deleteImageFile(filePath: string, thumbnailPath: string | null): Promise<void> {
  const root = path.join(process.cwd(), "..");
  await fs.unlink(path.join(root, filePath.replace(/\//g, path.sep))).catch(() => {});
  if (thumbnailPath) {
    await fs.unlink(path.join(root, thumbnailPath.replace(/\//g, path.sep))).catch(() => {});
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
