// Reading image bytes back off disk for the MCP layer.
//
// Two very different jobs live here:
//   * renderPreview — a ~512px JPEG that goes inline in a tool result so the
//     agent can actually look at what it made. Inlining the real thing is not
//     an option: a 4K PNG is tens of megabytes, and it would be base64'd into a
//     JSON-RPC response and then into the model's context window.
//   * readFullImage — the full-resolution bytes, served only through the
//     homefield://image/{id} resource, which the agent has to ask for by name.

import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

/** Longest edge of an inline preview, in pixels. */
export const PREVIEW_MAX_DIM = 512;
const PREVIEW_QUALITY = 70;

/** Refuse to inline a resource above this size rather than blow up the transport. */
export const MAX_RESOURCE_BYTES = 24 * 1024 * 1024;

/** Longest edge a library image is downsampled to before being used as a reference. */
const REFERENCE_MAX_DIM = 2048;
const REFERENCE_QUALITY = 88;

// Paths in the images table are stored relative to the project root (the
// directory above /web), e.g. "storage/images/<userId>/<id>.png".
const PROJECT_ROOT = path.join(process.cwd(), "..");
const STORAGE_ROOT = path.join(PROJECT_ROOT, "storage");

/**
 * Resolves a stored relative path to an absolute one, refusing anything that
 * escapes the storage directory. These paths come from our own database, but a
 * traversal check at the file system boundary costs nothing and means a bad row
 * cannot become an arbitrary file read.
 */
export function resolveStoragePath(relativePath: string): string {
  const absolute = path.resolve(PROJECT_ROOT, relativePath);
  const root = path.resolve(STORAGE_ROOT);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error(`Refusing to read outside the storage root: ${relativePath}`);
  }
  return absolute;
}

export interface InlineImage {
  base64: string;
  mimeType: string;
}

/**
 * Renders a small JPEG preview. Returns null when the file is missing or
 * unreadable — a preview is a convenience, never a reason to fail the tool.
 */
export async function renderPreview(relativePath: string): Promise<InlineImage | null> {
  try {
    const buffer = await sharp(resolveStoragePath(relativePath))
      .resize({ width: PREVIEW_MAX_DIM, height: PREVIEW_MAX_DIM, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: PREVIEW_QUALITY })
      .toBuffer();
    return { base64: buffer.toString("base64"), mimeType: "image/jpeg" };
  } catch (err) {
    console.error("[mcp] preview failed", relativePath, err);
    return null;
  }
}

/** Full-resolution bytes for the image resource. Throws if oversized or missing. */
export async function readFullImage(relativePath: string, mimeType: string): Promise<InlineImage> {
  const absolute = resolveStoragePath(relativePath);
  const stat = await fs.stat(absolute);
  if (stat.size > MAX_RESOURCE_BYTES) {
    throw new Error(
      `Image is ${Math.round(stat.size / 1024 / 1024)} MB, above the ${MAX_RESOURCE_BYTES / 1024 / 1024} MB inline limit. Download it from the HomeField UI instead.`,
    );
  }
  const buffer = await fs.readFile(absolute);
  return { base64: buffer.toString("base64"), mimeType };
}

/**
 * Loads a library image for use as a generation reference, downsampled below
 * the inline ceiling the generation pipeline expects.
 */
export async function readAsReference(relativePath: string): Promise<InlineImage> {
  const buffer = await sharp(resolveStoragePath(relativePath))
    .resize({ width: REFERENCE_MAX_DIM, height: REFERENCE_MAX_DIM, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: REFERENCE_QUALITY })
    .toBuffer();
  return { base64: buffer.toString("base64"), mimeType: "image/jpeg" };
}
