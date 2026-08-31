"use client";

import { useState } from "react";
import { AlertTriangle, Ban, Check, ShieldCheck, Trash2 } from "lucide-react";
import KeyJsonInput from "./KeyJsonInput";
import SetupGuide from "./SetupGuide";
import { TIER_META, formatUpdated } from "./tiers";
import type { MutationResult, OwnCredentialStatus } from "./useOwnCredentials";

interface Props {
  status: OwnCredentialStatus | null;
  loading: boolean;
  busy: boolean;
  onSave: (json: string) => Promise<MutationResult>;
  onClear: () => Promise<MutationResult>;
  /** True when this panel sits under the admin's instance-key section. */
  secondary?: boolean;
}

/**
 * A signed-in user's own Google key.
 *
 * The tier is stated, never offered: only an admin can change it (PATCH
 * /api/admin/credentials), and /api/credentials refuses an `access` field
 * outright. What a user CAN do is add or clear their own key, which bills their
 * generations to their own Google project — that takes nothing away from
 * anyone, so it needs no approval. It also never lifts a "none".
 */
export default function OwnKeyPanel({ status, loading, busy, onSave, onClear, secondary = false }: Props) {
  const [json, setJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showForm, setShowForm] = useState(false);

  if (loading && !status) {
    return <p className="text-sm text-text-secondary/50">Checking your access…</p>;
  }
  if (!status) {
    return <p className="text-sm text-red-400">Could not load your credential status.</p>;
  }

  const meta = TIER_META[status.access];
  const updated = formatUpdated(status.updatedAt);

  async function save() {
    setError(null);
    const result = await onSave(json);
    if (!result.ok) {
      setError(result.error ?? "Could not save the key.");
      return;
    }
    setJson("");
    setShowForm(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function clear() {
    setError(null);
    const result = await onClear();
    if (!result.ok) setError(result.error ?? "Could not remove the key.");
  }

  // "none" is a full stop: an upload form here would be a lie, because a stored
  // key does not lift the tier.
  if (status.access === "none") {
    return (
      <div className={secondary ? "mt-5 border-t border-[var(--border)] pt-5" : ""}>
        <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-3">
          <Ban size={16} className="mt-0.5 flex-shrink-0 text-red-400" />
          <div>
            <p className="text-sm text-text-primary">{meta.selfSummary}</p>
            <p className="mt-1 text-xs text-text-secondary/60">
              Ask an administrator of this instance to restore your access. Adding your own key
              would not change this.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const mustAddKey = status.access === "own" && !status.hasOwnKey;
  const formOpen = status.access === "own" || showForm || status.hasOwnKey;

  return (
    <div className={secondary ? "mt-5 border-t border-[var(--border)] pt-5" : ""}>
      {secondary && (
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-text-secondary/50">Your own key</p>
      )}

      {/* Current standing. Stated as policy, never as something to change here. */}
      <div className="mb-4 rounded-xl border border-[var(--border)] bg-white/[0.03] px-3.5 py-3">
        <p className="text-sm text-text-primary">{meta.selfSummary}</p>
        <p className="mt-1 text-xs text-text-secondary/50">
          Access tier: {meta.label} · set by an administrator
        </p>
        {status.access === "shared" && !status.canGenerate && (
          <p className="mt-2 text-xs text-amber-300">
            No instance key is connected yet. Ask an administrator to add one, or use your own
            Google project below.
          </p>
        )}
      </div>

      {/* The user's own key, when they have one. Identity only — never material. */}
      {status.hasOwnKey && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-accent/20 bg-accent/10 px-3.5 py-3">
          <ShieldCheck size={16} className="flex-shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="truncate text-sm text-text-primary">
              {status.clientEmail ? `Your key: ${status.clientEmail}` : "Your key is on file"}
            </p>
            <p className="truncate text-xs text-text-secondary/50">
              {status.projectId ? `Project ${status.projectId}` : "Stored securely, encrypted"}
              {updated ? ` · added ${updated}` : ""}
            </p>
          </div>
        </div>
      )}

      {mustAddKey && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-3">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-amber-400" />
          <div>
            <p className="text-sm text-text-primary">You cannot generate until you add a key.</p>
            <p className="mt-1 text-xs text-text-secondary/60">
              An administrator put your account on its own Google project, so generations bill to
              you rather than to this instance.
            </p>
          </div>
        </div>
      )}

      {/* A "shared" user may still choose to pay for their own generations. */}
      {status.access === "shared" && !status.hasOwnKey && !showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="w-full rounded-xl border border-[var(--border)] bg-white/[0.03] px-3.5 py-2.5 text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          Use my own Google project instead
        </button>
      )}

      {formOpen && (
        <>
          <KeyJsonInput
            value={json}
            onChange={setJson}
            label={status.hasOwnKey ? "Replace your key" : "Your service account JSON"}
            disabled={busy}
          />

          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

          <button
            onClick={save}
            disabled={busy || !json.trim()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saved ? (
              <><Check size={15} /> Saved</>
            ) : busy ? (
              "Verifying key…"
            ) : status.hasOwnKey ? (
              "Save new key"
            ) : (
              "Add my key"
            )}
          </button>

          {status.hasOwnKey && (
            <>
              <button
                onClick={clear}
                disabled={busy}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs text-text-secondary/60 transition-colors hover:text-red-400 disabled:opacity-40"
              >
                <Trash2 size={13} /> Remove my key
              </button>
              <p className="mt-1 text-center text-[11px] text-text-secondary/40">
                {status.access === "own"
                  ? "Removing it stops your generations until you add another key."
                  : "Removing it puts your generations back on the instance key."}
              </p>
            </>
          )}

          <SetupGuide />
        </>
      )}
    </div>
  );
}
