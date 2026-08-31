import type { ImageOrigin } from "@/lib/types";

/**
 * Violet is the semantic colour of agent provenance across the whole app.
 * The lime `--accent` means "you did this"; violet means "something acting on
 * your behalf did". Defined once here so the card badge, the lightbox row, the
 * gallery filter and the setup flow can never drift apart.
 *
 * The tints follow the same shape the app already uses for its amber "shared"
 * chips (mid-tone colour + /12 fill + /25 border), so they read correctly in
 * both the dark and the light theme without a second palette.
 */
export const AGENT_ACCENT_HEX = "#a78bfa"; // violet-400

/** Text-only accent, for labels and icons on app surfaces. */
export const AGENT_TEXT = "text-violet-400";

/** Tinted pill on an app surface (settings, lightbox panels). */
export const AGENT_CHIP = "bg-violet-400/12 border border-violet-400/25 text-violet-400";

/** Tinted pill sitting on an image, where the ground is always dark. */
export const AGENT_CHIP_ON_IMAGE = "bg-violet-500/40 text-violet-50 backdrop-blur-sm";

/** Filled control — the setup flow's primary action. */
export const AGENT_BUTTON = "bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-40";

/** Chosen state for options inside the setup flow. */
export const AGENT_SELECTED = "bg-violet-400/15 border-violet-400/40 text-violet-300";

/** Unchosen state for those same options. */
export const AGENT_UNSELECTED =
  "bg-[var(--border)] border-transparent text-text-secondary hover:text-text-primary";

export interface AgentProvenanceFields {
  origin?: ImageOrigin | null;
  agentLabel?: string | null;
}

/**
 * The label to show for an agent-made image, or null when a person made it.
 * A stored agentLabel counts on its own: rows written before the origin column
 * existed, and rows whose key has since been revoked, still carry their label.
 */
export function agentLabelOf(image: AgentProvenanceFields): string | null {
  if (image.origin !== "agent" && !image.agentLabel) return null;
  return image.agentLabel?.trim() || "Agent";
}
