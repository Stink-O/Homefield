import type { ImageOrigin } from "@/lib/types";

/**
 * Agent provenance uses the app's own accent rather than a colour of its own.
 *
 * An earlier version introduced violet to mean "an agent did this". It read as
 * foreign: the app is built on one lime accent plus amber for the shared space,
 * and a third hue looked like it belonged to a different product. The label
 * already says which agent made the image, so the colour never had to carry
 * that meaning on its own.
 *
 * Defined once here so the card badge, the lightbox row, the gallery filter and
 * the setup flow cannot drift apart.
 */

/** Text-only accent, for labels and icons on app surfaces. */
export const AGENT_TEXT = "text-accent";

/** Tinted pill on an app surface, matching the amber shared-space chip's shape. */
export const AGENT_CHIP = "bg-accent/12 border border-accent/25 text-accent";

/** Pill sitting on an image. Matches the model chip already on the card. */
export const AGENT_CHIP_ON_IMAGE = "bg-black/40 text-white/70 backdrop-blur-sm";

/** Filled control: the app's primary button. */
export const AGENT_BUTTON = "bg-accent text-black font-semibold hover:bg-accent-hover disabled:opacity-40";

/** Chosen state for options, matching the theme picker in Settings. */
export const AGENT_SELECTED = "bg-accent/20 border-accent/30 text-accent";

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
