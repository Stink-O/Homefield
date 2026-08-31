// One description of the three credential tiers, shared by the admin table and
// the user-facing settings UI so the two can never tell different stories.
//
// The tiers themselves are defined in lib/credentialStore.ts and are admin
// policy: nothing here may imply a user can move between them.

import type { CredentialAccess } from "@/lib/agent/contract";

/** Ordered for display: the default first, then the two deliberate choices. */
export const CREDENTIAL_TIERS: CredentialAccess[] = ["shared", "own", "none"];

export interface TierMeta {
  /** Full label, for headings and option rows. */
  label: string;
  /** Compact label, for a badge in a crowded table row. */
  short: string;
  /** What this tier means, written about somebody else (admin view). */
  consequence: string;
  /** What this tier means, written to the person on it. */
  selfSummary: string;
  /** Pill classes: tint + border + text, matching the app's chip idiom. */
  chip: string;
}

export const TIER_META: Record<CredentialAccess, TierMeta> = {
  shared: {
    label: "Instance key",
    short: "Instance",
    consequence: "Generations are billed to this instance's Google project.",
    selfSummary: "Your generations use the instance's Google Cloud key.",
    chip: "bg-amber-400/12 border border-amber-400/25 text-amber-300",
  },
  own: {
    label: "Own key",
    short: "Own",
    consequence: "Generations are billed to this user's own Google project. They cannot generate until they add a key.",
    selfSummary: "Your generations are billed to your own Google Cloud project.",
    chip: "bg-sky-400/12 border border-sky-400/25 text-sky-300",
  },
  none: {
    label: "No access",
    short: "None",
    consequence: "This user cannot generate at all, whatever key is stored.",
    selfSummary: "Generation is turned off for your account.",
    chip: "bg-red-500/12 border border-red-500/25 text-red-300",
  },
};

/** The tier a user has when no row has been written for them yet. */
export const DEFAULT_TIER: CredentialAccess = "shared";

/** True when the tier leaves this account unable to generate right now. */
export function isBlocked(access: CredentialAccess, hasOwnKey: boolean): boolean {
  if (access === "none") return true;
  return access === "own" && !hasOwnKey;
}

/**
 * What changes for `username` if the admin moves them to `next`. Returned as
 * `severity` so the caller can colour a warning rather than a note — a tier
 * change that stops somebody generating must not read as cosmetic.
 */
export function tierChangeEffect(
  username: string,
  next: CredentialAccess,
  hasOwnKey: boolean,
): { severity: "warn" | "info"; text: string } {
  if (next === "none") {
    return { severity: "warn", text: `${username} will not be able to generate at all.` };
  }
  if (next === "own") {
    return hasOwnKey
      ? { severity: "info", text: `${username}'s generations will bill to their own Google project.` }
      : { severity: "warn", text: `${username} will not be able to generate until they add their own key.` };
  }
  return hasOwnKey
    ? {
        severity: "info",
        text: `${username} may fall back to the instance key — but their own key is still on file and takes priority while it is there.`,
      }
    : { severity: "info", text: `${username}'s generations will bill to this instance's Google project.` };
}

/** Formats a stored key's last-updated timestamp, or null when there is none. */
export function formatUpdated(updatedAt: number | null): string | null {
  if (!updatedAt) return null;
  return new Date(updatedAt).toLocaleDateString();
}
