import type { GeneratedImageMeta } from "@/lib/types";

export const SPACING = 6;

export interface GalleryPhoto {
  src: string;
  width: number;
  height: number;
  key: string;
  alt: string;
  _image: GeneratedImageMeta | null;
  isPending: boolean;
  pendingId?: string;
  pendingPrompt?: string;
  pendingStartedAt?: number;
  pendingFailed?: boolean;
  pendingErrorMessage?: string;
  pendingGenerating?: boolean;
}

export interface RowPhoto extends GalleryPhoto {
  renderWidth: number;
  renderHeight: number;
  globalIndex: number;
}

export interface GalleryRow {
  photos: RowPhoto[];
  height: number;
}

export function computeRowLayout(
  photos: GalleryPhoto[],
  containerWidth: number,
  targetRowHeight: number,
  maxPhotos: number,
): GalleryRow[] {
  if (containerWidth <= 0 || photos.length === 0) return [];

  const rows: GalleryRow[] = [];
  let i = 0;
  let globalIndex = 0;

  while (i < photos.length) {
    // Start with one photo, then greedily add more until the row would overflow
    let j = i + 1;
    let totalAR = photos[i].width / photos[i].height;

    while (j < photos.length && j - i < maxPhotos) {
      const ar = photos[j].width / photos[j].height;
      // Projected row width if we add this photo at targetRowHeight
      const projectedWidth = (totalAR + ar) * targetRowHeight + (j - i) * SPACING;
      if (projectedWidth > containerWidth) break;
      totalAR += ar;
      j++;
    }

    const photosInRow = photos.slice(i, j);
    const isLastRow = j >= photos.length;
    const totalSpacing = (photosInRow.length - 1) * SPACING;
    const totalAspectRatio = photosInRow.reduce((sum, p) => sum + p.width / p.height, 0);
    const stretchedHeight = (containerWidth - totalSpacing) / totalAspectRatio;
    // Last row: don't stretch beyond targetRowHeight — looks bad when there are few images
    const rowHeight = isLastRow ? Math.min(stretchedHeight, targetRowHeight) : stretchedHeight;

    rows.push({
      photos: photosInRow.map((p, idx) => ({
        ...p,
        renderWidth: rowHeight * (p.width / p.height),
        renderHeight: rowHeight,
        globalIndex: globalIndex + idx,
      })),
      height: rowHeight,
    });

    globalIndex += photosInRow.length;
    i = j;
  }

  return rows;
}
