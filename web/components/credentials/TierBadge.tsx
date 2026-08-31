"use client";

import { AlertTriangle } from "lucide-react";
import type { CredentialAccess } from "@/lib/agent/contract";
import { TIER_META, isBlocked } from "./tiers";

interface Props {
  access: CredentialAccess;
  hasOwnKey: boolean;
  /** Compact form for a table row; the full label everywhere else. */
  compact?: boolean;
  /** Makes the badge the control that opens the tier editor. */
  onClick?: () => void;
  active?: boolean;
}

/**
 * The tier, visible in the row itself rather than hidden behind a menu — an
 * admin scanning the list needs to see who is spending the instance's credit.
 * The warning triangle marks an account that cannot generate as things stand.
 */
export default function TierBadge({ access, hasOwnKey, compact = false, onClick, active = false }: Props) {
  const meta = TIER_META[access];
  const blocked = isBlocked(access, hasOwnKey);
  const label = compact ? meta.short : meta.label;
  const title = blocked && access === "own"
    ? `${meta.consequence} No key has been added yet.`
    : meta.consequence;

  const body = (
    <>
      {blocked && <AlertTriangle size={11} className="shrink-0" />}
      {label}
    </>
  );

  const base = `inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.chip}`;

  if (!onClick) {
    return <span className={base} title={title}>{body}</span>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${title} Click to change.`}
      className={`${base} transition-opacity hover:opacity-80 ${active ? "ring-1 ring-inset ring-current" : ""}`}
    >
      {body}
    </button>
  );
}
