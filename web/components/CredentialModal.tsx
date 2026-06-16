"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Upload, Check, KeyRound, ChevronDown, ExternalLink, Trash2, ShieldCheck } from "lucide-react";
import { useApp } from "@/contexts/AppContext";

interface CredentialStatus {
  configured: boolean;
  source: "db" | "env" | "none";
  isAdmin: boolean;
  clientEmail: string | null;
  projectId: string | null;
}

export default function CredentialModal() {
  const { state, dispatch } = useApp();
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [json, setJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const open = state.credentialModalOpen;

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

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setJson(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(file);
  };

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

  if (!open) return null;

  const isAdmin = status?.isAdmin ?? false;
  const onEnv = status?.source === "env";

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

          {/* Connected state */}
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

          {!isAdmin ? (
            <p className="text-sm text-text-secondary leading-relaxed">
              A Google Cloud key is needed for media generation. Ask the administrator of this
              instance to add one.
            </p>
          ) : (
            <>
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

              <label className="block text-xs font-medium uppercase tracking-wider text-text-secondary/50 mb-2">
                {status?.configured ? "Replace key" : "Service account JSON"}
              </label>
              <textarea
                value={json}
                onChange={(e) => setJson(e.target.value)}
                spellCheck={false}
                placeholder={'{\n  "type": "service_account",\n  "project_id": "...",\n  ...\n}'}
                className="w-full h-32 resize-none rounded-xl bg-white/[0.03] border border-[var(--border)] px-3.5 py-3 font-mono text-xs text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-accent/40 transition-colors"
              />

              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--border)] px-3 py-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
                >
                  <Upload size={13} /> Upload .json
                </button>
                <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFile} />
                <span className="text-xs text-text-secondary/40">Pasted keys never leave this server.</span>
              </div>

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

              {/* Tutorial slot — free trial guide */}
              <div className="mt-5 border-t border-[var(--border)] pt-4">
                <button
                  onClick={() => setGuideOpen((v) => !v)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <span className="text-sm text-text-primary">Don&apos;t have a key? Get $300 free credit</span>
                  <ChevronDown
                    size={15}
                    className="text-text-secondary/40 transition-transform duration-200"
                    style={{ transform: guideOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                  />
                </button>
                <AnimatePresence>
                  {guideOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <ol className="mt-3 space-y-2 text-xs text-text-secondary/70 leading-relaxed list-decimal pl-4">
                        <li>Start a free Google Cloud trial to get $300 in credit.</li>
                        <li>Create a project and enable the Vertex AI API.</li>
                        <li>Create a service account, then add a JSON key.</li>
                        <li>Download the key file and upload it above.</li>
                      </ol>
                      <a
                        href="https://cloud.google.com/free"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
                      >
                        Open Google Cloud free trial <ExternalLink size={12} />
                      </a>
                      <p className="mt-2 text-[11px] text-text-secondary/40">
                        A full step-by-step walkthrough is coming soon.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
