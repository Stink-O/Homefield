// Max dimension for grid thumbnails (width or height), in logical pixels.
// 1200px covers 2× retina at the largest gallery row height (~680px).
const THUMB_MAX_DIM = 1200;
const THUMB_QUALITY = 0.82;

export async function generateThumbnail(
  base64: string,
  mimeType: string,
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, THUMB_MAX_DIM / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", THUMB_QUALITY);
      resolve(dataUrl.split(",")[1]);
    };
    img.onerror = () => resolve(base64); // fallback: no thumbnail
    img.src = `data:${mimeType};base64,${base64}`;
  });
}
