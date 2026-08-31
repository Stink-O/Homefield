// Zod parameter schemas shared by the tools.
//
// Every enumerated value is derived from lib/types.ts rather than retyped, so
// the tool surface and the app cannot drift apart. Enums (not free strings) are
// what make a discovery tool unnecessary: the model, quality and aspect-ratio
// choices arrive in the schema the client already reads, and an agent has no
// way to emit a value the app would reject.
//
// Cross-field rules — which quality each model supports — cannot be expressed
// in a JSON Schema enum, so they are spelled out in the parameter descriptions
// and enforced again server-side in generation.ts.

import { z } from "zod";
import {
  ASPECT_RATIOS,
  MAX_PROMPT_LENGTH,
  MODELS,
  MODEL_IMAGE_LIMITS,
  MODEL_QUALITIES,
  QUALITIES,
  type ModelId,
  type Quality,
} from "@/lib/types";
import { MAIN_WORKSPACE } from "@/lib/mcp/context";

export const MODEL_IDS = MODELS.map((m) => m.id);
export const QUALITY_IDS = QUALITIES.map((q) => q.id);

/** Human-readable model catalogue, built from MODELS so it never goes stale. */
const MODEL_CATALOGUE = MODELS.map((m) => `"${m.id}" = ${m.label} (${m.description})`).join("; ");

/** Which qualities each model actually supports, built from MODEL_QUALITIES. */
const QUALITY_MATRIX = MODELS.map((m) => `${m.id}: ${MODEL_QUALITIES[m.id].join("/")}`).join("; ");

export const modelSchema = z.enum(MODEL_IDS).describe(
  `Image model. ${MODEL_CATALOGUE}. The key's owner may have capped which models it can reach; a request above the cap is refused with model_exceeds_limit.`,
);

export const qualitySchema = z.enum(QUALITY_IDS).describe(
  `Output resolution tier. Not every model supports every tier — ${QUALITY_MATRIX}. In particular: "512" is Flash-only (Pro and Lite reject it), and Lite caps at 1K (no 2K or 4K). Defaults to "1K". A tier above the key's ceiling is refused with quality_exceeds_limit.`,
);

export const aspectRatioSchema = z.enum(ASPECT_RATIOS).describe(
  `Aspect ratio of the output. "Auto" lets the model pick one to suit the prompt. Defaults to "Auto".`,
);

export const promptSchema = z.string().trim().min(1).max(MAX_PROMPT_LENGTH).describe(
  `The image prompt. Up to ${MAX_PROMPT_LENGTH} characters.`,
);

export const workspaceIdSchema = z.string().min(1).describe(
  `Target workspace id, or "${MAIN_WORKSPACE}" for the owner's Main library. Whether this is honoured depends on the key's destination mode — see the tool description.`,
);

export const imageIdSchema = z.string().min(1).describe("Id of an image in the owner's library.");

/** Reference-image ceiling, taken from the per-model limits in types.ts. */
export const MAX_REFERENCE_IMAGES = Math.max(...Object.values(MODEL_IMAGE_LIMITS));

/** Base64 ceiling per uploaded reference, matching the REST generate route. */
export const MAX_REFERENCE_BASE64 = 10 * 1024 * 1024;

export const UPLOAD_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const referenceUploadSchema = z.object({
  base64: z.string().min(1).max(MAX_REFERENCE_BASE64).describe("Raw image bytes, base64 encoded, without a data: URL prefix."),
  mime_type: z.enum(UPLOAD_MIME_TYPES).describe("MIME type of the uploaded bytes."),
});

/** Runtime guard for the model/quality pairing, mirroring MODEL_QUALITIES. */
export function qualitySupportedByModel(model: ModelId, quality: Quality): boolean {
  return MODEL_QUALITIES[model].includes(quality);
}

export function qualitySupportMessage(model: ModelId, quality: Quality): string {
  return `Model "${model}" does not support quality "${quality}". Supported: ${MODEL_QUALITIES[model].join(", ")}.`;
}
