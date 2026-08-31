"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, KeyRound, Trash2, ShieldCheck } from "lucide-react";
import { useApp } from "@/contexts/AppContext";
import KeyJsonInput from "./credentials/KeyJsonInput";
import SetupGuide from "./credentials/SetupGuide";
import OwnKeyPanel from "./credentials/OwnKeyPanel";
import { useOwnCredentials } from "./credentials/useOwnCredentials";

/** GET /api/admin/credentials — the INSTANCE key. Readable by any signed-in user. */
interface CredentialStatus {
  configured: boolean;
  source: "db" | "env" | "none";
  isAdmin: boolean;
  clientEmail: string | null;
  projectId: string | null;
}

/**
 * Google Cloud credentials.
 *
 * Two audiences in one modal: an admin manages the instance key everyone on the
 * "shared" tier draws on, and every user manages their own key and sees the
 * tier an admin put them on. The tier is never editable here — see
 * OwnKeyPanel and PATCH /api/admin/credentials.
 */
export default function CredentialModal() {
  const { state, dispatch } = useApp();
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [json, setJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const open = state.credentialModalOpen;
  const { status: own, loading: ownLoading, busy: ownBusy, saveKey, clearKey } = useOwnCredentials(open);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/credentials");
      if (res.ok) setStatus(await res.json());
    } catch {
      /* leave status null; the form still works */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaved(false);
    setJson("");
    loadStatus();
  }, [open, loadStatus]);

  const close = () => dispatch({ type: "CLOSE_CREDENTIAL_MODAL" });

  async function save(payload: { json: string } | { migrateFromEnv: true }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save the key.");
        return;
      }
      setStatus((s) => (s ? { ...s, ...data } : data));
      dispatch({ type: "SET_MEDIA_KEY_CONFIGURED", payload: true });
      setSaved(true);
      setJson("");
      setTimeout(() => { setSaved(false); close(); }, 1100);
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/credentials", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not remove the key.");
        return;
      }
      setStatus((s) => (s ? { ...s, ...data } : data));
      dispatch({ type: "SET_MEDIA_KEY_CONFIGURED", payload: !!data.configured });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  // A user's own key decides whether THEY can generate, so the banner that says
  // generation is unavailable has to follow their resolved status, not the
  // instance key alone.
  const syncOwn = useCallback(
    async (run: () => Promise<{ ok: boolean; error?: string }>) => {
      const result = await run();
      if (result.ok) {
        const res = await fetch("/api/credentials", { cache: "no-store" }).catch(() => null);
        const data = res?.ok ? await res.json().catch(() => null) : null;
        if (data && typeof data.canGenerate === "boolean") {
          dispatch({ type: "SET_MEDIA_KEY_CONFIGURED", payload: data.canGenerate });
        }
      }
      return result;
    },
    [dispatch],
  );

  if (!open) return null;

  const isAdmin = status?.isAdmin ?? false;
  const onEnv = status?.source === "env";
  // An admin on a non-default tier still needs their own key panel: their
  // generations resolve through the same tiers as everyone else's.
  const adminNeedsOwnPanel = !!own && (own.access !== "shared" || own.hasOwnKey);

  return (
    <AnimatePresence>
      <motion.div
        key="cred-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={close}
        className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      >
        <motion.div
          key="cred-content"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="glass-heavy w-full max-w-md rounded-2xl p-6 overflow-y-auto max-h-[90dvh]"
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 border border-accent/25">
                <KeyRound size={16} className="text-accent" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-text-primary leading-tight">Connect Google Cloud</h2>
                <p className="text-xs text-text-secondary/60 mt-0.5">Required for image and music generation</p>
              </div>
            </div>
            <button
              onClick={close}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary transition-colors hover:text-text-primary hover:bg-[var(--border)]"
            >
              <X size={16} />
            </button>
          </div>

          {!isAdmin ? (
            <OwnKeyPanel
              status={own}
              loading={ownLoading}
              busy={ownBusy}
              onSave={(value) => syncOwn(() => saveKey(value))}
              onClear={() => syncOwn(clearKey)}
            />
          ) : (
            <>
              {/* Connected state — the instance key */}
              {status?.configured && (
                <div className="mb-4 flex items-center gap-3 rounded-xl bg-accent/10 border border-accent/20 px-3.5 py-3">
                  <ShieldCheck size={16} className="text-accent flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary truncate">
                      {status.clientEmail ? `Connected as ${status.clientEmail}` : "Connected"}
                    </p>
                    <p className="text-xs text-text-secondary/50">
                      {onEnv ? "Loaded from environment file" : "Stored securely, encrypted"}
                    </p>
                  </div>
                </div>
              )}

              {/* Env import prompt: existing env key not yet in secure storage */}
              {onEnv && (
                <button
                  onClick={() => save({ migrateFromEnv: true })}
                  disabled={saving}
                  className="mb-4 w-full rounded-xl border border-accent/30 bg-accent/10 px-3.5 py-2.5 text-sm text-accent hover:bg-accent/15 transition-colors disabled:opacity-50"
                >
                  Move this key into encrypted storage
                </button>
              )}

              <KeyJsonInput
                value={json}
                onChange={setJson}
                label={status?.configured ? "Replace key" : "Service account JSON"}
                disabled={saving}
              />

              <p className="mt-2 text-xs text-text-secondary/40">
                This is the instance key. Everyone on the shared tier generates with it.
              </p>

              {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

              <button
                onClick={() => save({ json })}
                disabled={saving || !json.trim()}
                className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saved ? <><Check size={15} /> Connected</> : saving ? "Verifying key..." : status?.configured ? "Save new key" : "Connect"}
              </button>

              {status?.configured && status.source === "db" && (
                <button
                  onClick={remove}
                  disabled={saving}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs text-text-secondary/60 hover:text-red-400 transition-colors disabled:opacity-40"
                >
                  <Trash2 size={13} /> Remove key
                </button>
              )}

              <SetupGuide />

              {adminNeedsOwnPanel && (
                <OwnKeyPanel
                  status={own}
                  loading={ownLoading}
                  busy={ownBusy}
                  onSave={(value) => syncOwn(() => saveKey(value))}
                  onClear={() => syncOwn(clearKey)}
                  secondary
                />
              )}
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
