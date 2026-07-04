import { ASPECT_RATIOS, type AspectRatio, type AttachedImage } from "./types";

// Client-only: decodes a reference image to read its natural dimensions.
export function getRefImageDimensions(img: AttachedImage): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const el = new window.Image();
    el.onload = () => resolve({ width: el.naturalWidth, height: el.naturalHeight });
    el.onerror = () => resolve({ width: 1024, height: 1024 });
    el.src = `data:${img.mimeType};base64,${img.base64}`;
  });
}

export function closestAspectRatio(width: number, height: number): AspectRatio {
  const ratio = width / height;
  const candidates = ASPECT_RATIOS.filter((ar) => ar !== "Auto") as AspectRatio[];
  let best: AspectRatio = "1:1";
  let bestDiff = Infinity;
  for (const ar of candidates) {
    const [w, h] = ar.split(":").map(Number);
    const diff = Math.abs(ratio - w / h);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = ar;
    }
  }
  return best;
}
