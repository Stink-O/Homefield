"use client";

import { useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import type { CredentialAccess } from "@/lib/agent/contract";
import { CREDENTIAL_TIERS, TIER_META, tierChangeEffect } from "./tiers";

interface Props {
  userId: string;
  username: string;
  access: CredentialAccess;
  hasOwnKey: boolean;
  /** Called after the tier is stored, so the table can reload. */
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * The admin control for one user's credential tier. Inline under the row, like
 * the username/password editor beside it.
 *
 * Nothing applies until Apply is pressed, and the consequence of the pending
 * choice is spelled out first: two of the three tiers stop the user generating.
 */
export default function UserTierPanel({ userId, username, access, hasOwnKey, onSaved, onCancel }: Props) {
  const [choice, setChoice] = useState<CredentialAccess>(access);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const dirty = choice !== access;
  const effect = tierChangeEffect(username, choice, hasOwnKey);

  async function apply() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/credentials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, access: choice }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not update the access tier.");
        return;
      }
      onSaved();
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--chrome-border)] px-4 sm:px-6 pt-4 pb-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary/60">
          Generation credentials
        </p>
        <p className="mt-1 text-xs text-text-secondary/50">
          Who pays for {username}&apos;s generations. Only an admin can set this.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {CREDENTIAL_TIERS.map((tier) => {
          const meta = TIER_META[tier];
          const selected = choice === tier;
          return (
            <button
              key={tier}
              onClick={() => setChoice(tier)}
              className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                selected
                  ? "border-[#a3e635]/40 bg-[#a3e635]/10"
                  : "border-[var(--chrome-border)] bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-hover)]"
              }`}
            >
              <span
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border ${
                  selected ? "border-[#a3e635] bg-[#a3e635]" : "border-text-secondary/40"
                }`}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{meta.label}</span>
                  {tier === access && (
                    <span className="rounded-full bg-[var(--chrome-surface-hover)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-secondary/60">
                      current
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-text-secondary/60">
                  {meta.consequence}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {dirty && (
        <div
          className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 ${
            effect.severity === "warn"
              ? "border-amber-500/25 bg-amber-500/10 text-amber-200"
              : "border-[var(--chrome-border)] bg-[var(--chrome-surface)] text-text-secondary/70"
          }`}
        >
          {effect.severity === "warn" ? (
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
          ) : (
            <Info size={14} className="mt-0.5 shrink-0 text-text-secondary/50" />
          )}
          <p className="text-xs leading-relaxed">{effect.text}</p>
        </div>
      )}

      {!dirty && hasOwnKey && (
        <p className="text-xs text-text-secondary/40">
          {username} has their own key on file.
        </p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={apply}
          disabled={saving || !dirty}
          className="rounded-xl bg-[#a3e635] px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#bef264] disabled:opacity-50"
        >
          {saving ? "Applying..." : "Apply tier"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-xl bg-[var(--chrome-surface-hover)] px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
