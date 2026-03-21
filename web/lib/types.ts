export interface AttachedImage {
  base64: string;
  mimeType: string;
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
}

// Per Google Vertex AI docs: both Gemini image generation models support up to 14 reference images,
// 7 MB max per image (inline data).
export const MODEL_IMAGE_LIMITS: Record<ModelId, number> = {
  "gemini-3.1-flash-image-preview": 14,
  "gemini-3-pro-image-preview": 14,
};

export interface GeneratedImage {
  id: string;
  prompt: string;
  model: ModelId;
  aspectRatio: AspectRatio;
  base64?: string; // absent in server model (image lives on disk)
  mimeType: string;
  width: number;
  height: number;
  timestamp: number;
  quality?: Quality;
  searchGrounding?: boolean;
  selectedAspectRatio?: AspectRatio; // what the user had selected (e.g. "Auto"), before resolution
  referenceImageDataUrls?: string[];
  thumbnailBase64?: string; // legacy: JPEG-compressed thumbnail stored inline (old IndexedDB model)
  thumbnailUrl?: string;    // server model: URL served from /api/files/...
  workspaceId?: string;
  userId?: string;          // server model: which user generated this
  username?: string;        // server model: display name of the generating user
  filePath?: string;        // server model: relative path on disk
}

// Metadata-only view: base64 payload excluded (image lives on server disk).
// referenceImageDataUrls kept as optional so the lightbox can still show them if present.
export type GeneratedImageMeta = Omit<GeneratedImage, "base64">;

export type ModelId =
  | "gemini-3.1-flash-image-preview"
  | "gemini-3-pro-image-preview";

export interface ModelOption {
  id: ModelId;
  label: string;
  shortLabel: string;
  description: string;
  badge?: string;
}

export const MODELS: ModelOption[] = [
  {
    id: "gemini-3.1-flash-image-preview",
    label: "Nano Banana 2",
    shortLabel: "NB2",
    description: "Pro-level quality at Flash speed",
    badge: "NEW",
  },
  {
    id: "gemini-3-pro-image-preview",
    label: "Nano Banana Pro",
    shortLabel: "Pro",
    description: "Google's flagship image generation model",
  },
];

export type AspectRatio =
  | "Auto"
  | "1:1"
  | "2:3"
  | "3:2"
  | "3:4"
  | "4:3"
  | "4:5"
  | "5:4"
  | "9:16"
  | "16:9"
  | "21:9";

export const ASPECT_RATIOS: AspectRatio[] = [
  "Auto", "1:1", "3:4", "4:3", "2:3", "3:2",
  "9:16", "16:9", "5:4", "4:5", "21:9",
];

// Both models support the same confirmed-working set.
export const MODEL_ASPECT_RATIOS: Record<ModelId, AspectRatio[]> = {
  "gemini-3.1-flash-image-preview": [
    "Auto", "1:1", "3:4", "4:3", "2:3", "3:2",
    "9:16", "16:9", "5:4", "4:5", "21:9",
  ],
  "gemini-3-pro-image-preview": [
    "Auto", "1:1", "3:4", "4:3", "2:3", "3:2",
    "9:16", "16:9", "5:4", "4:5", "21:9",
  ],
};

export type Quality = "1K" | "2K" | "4K";

export const QUALITIES: { id: Quality; label: string }[] = [
  { id: "1K", label: "1K" },
  { id: "2K", label: "2K" },
  { id: "4K", label: "4K" },
];

export type BatchSize = 1 | 2 | 3 | 4;

// Gallery size presets — index 2 is the default (medium).
// Each step pairs a targetRowHeight hint with a maxPhotos constraint so that
// larger size steps are visually distinct even when container width would
// otherwise cause the row algorithm to produce identically-sized rows.
export const ROW_CONFIGS = [
  { targetRowHeight: 300, maxPhotos: 7  }, // index 0 — small (smallest)
  { targetRowHeight: 390, maxPhotos: 5  }, // index 1 — between small and medium
  { targetRowHeight: 480, maxPhotos: 4  }, // index 2 — medium (default)
  { targetRowHeight: 580, maxPhotos: 3  }, // index 3 — between medium and large
  { targetRowHeight: 680, maxPhotos: 2  }, // index 4 — large (largest)
] as const;
export type RowHeightIndex = 0 | 1 | 2 | 3 | 4;

// Dimensions reflect actual 1K output from the Vertex AI API (~1M px total area).
// Used for shimmer placeholder sizing and as a fallback if image load fails.
export function getAspectDimensions(ratio: AspectRatio): {
  width: number;
  height: number;
} {
  switch (ratio) {
    case "Auto":  return { width: 1024, height: 1024 };
    case "1:1":   return { width: 1024, height: 1024 };
    case "16:9":  return { width: 1344, height: 768 };
    case "9:16":  return { width: 768,  height: 1344 };
    case "3:2":   return { width: 1248, height: 832 };
    case "2:3":   return { width: 832,  height: 1248 };
    case "4:3":   return { width: 1152, height: 864 };
    case "3:4":   return { width: 864,  height: 1152 };
    case "5:4":   return { width: 1152, height: 918 };
    case "4:5":   return { width: 918,  height: 1152 };
    case "21:9":  return { width: 1536, height: 672 };
    default:      return { width: 1024, height: 1024 };
  }
}
