"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronDown, Download, Upload, Check, Sun, Moon, Monitor } from "lucide-react";
import { useApp } from "@/contexts/AppContext";
// Legacy export/import from IndexedDB removed — images now stored server-side.

export default function SettingsModal() {
  const { state, dispatch } = useApp();
  const [devTools, setDevTools] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("erudaEnabled") === "true"
  );
  const [devOverlay, setDevOverlay] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("devOverlay") === "true"
  );
  const [showElapsedTime, setShowElapsedTime] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("showElapsedTime") === "true"
  );
  const [reloadPending, setReloadPending] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importStatus, setImportStatus] = useState<null | "importing" | "done" | "error">(null);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/export");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "homefield-export.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently fail
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportStatus("importing");
    setImportResult(null);
    setImportError(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        body: file,
        headers: { "Content-Type": "application/zip" },
      });
      const data = await res.json().catch(() => ({})) as { imported?: number; skipped?: number; error?: string };
      if (!res.ok) {
        setImportError(data.error ?? "Import failed");
        setImportStatus("error");
        setTimeout(() => { setImportStatus(null); setImportError(null); }, 5000);
        return;
      }
      setImportResult({ imported: data.imported ?? 0, skipped: data.skipped ?? 0 });
      setImportStatus("done");
      setTimeout(() => window.location.reload(), 2000);
    } catch {
      setImportError("Could not reach the server. Check your connection.");
      setImportStatus("error");
      setTimeout(() => { setImportStatus(null); setImportError(null); }, 5000);
    }
  };

  if (!state.settingsOpen) return null;

  const handleDevToolsToggle = () => {
    const next = !devTools;
    setDevTools(next);
    localStorage.setItem("erudaEnabled", next ? "true" : "false");
    setReloadPending(true);
  };

  const handleDevOverlayToggle = () => {
    const next = !devOverlay;
    setDevOverlay(next);
    localStorage.setItem("devOverlay", next ? "true" : "false");
    setReloadPending(true);
  };

  const handleElapsedTimeToggle = () => {
    const next = !showElapsedTime;
    setShowElapsedTime(next);
    localStorage.setItem("showElapsedTime", next ? "true" : "false");
  };

  return (
    <AnimatePresence>
      <motion.div
        key="settings-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={() => dispatch({ type: "TOGGLE_SETTINGS" })}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      >
        <motion.div
          key="settings-content"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="glass-heavy w-full max-w-md rounded-2xl p-6 overflow-y-auto max-h-[90dvh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-text-primary">Settings</h2>
            <button
              onClick={() => dispatch({ type: "TOGGLE_SETTINGS" })}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary transition-colors hover:text-text-primary hover:bg-[var(--border)]"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-5">
            {/* Theme */}
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-text-secondary/50 mb-3">Appearance</p>
              <div className="flex gap-2 rounded-xl bg-white/[0.03] p-3 border border-[var(--border)]">
                <button
                  onClick={() => dispatch({ type: "SET_THEME", payload: "dark" })}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors ${
                    state.theme === "dark"
                      ? "bg-accent/20 text-accent border border-accent/30"
                      : "bg-[var(--border)] text-text-secondary hover:text-text-primary border border-transparent"
                  }`}
                >
                  <Moon size={14} />
                  Dark
                </button>
                <button
                  onClick={() => dispatch({ type: "SET_THEME", payload: "light" })}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors ${
                    state.theme === "light"
                      ? "bg-accent/20 text-accent border border-accent/30"
                      : "bg-[var(--border)] text-text-secondary hover:text-text-primary border border-transparent"
                  }`}
                >
                  <Sun size={14} />
                  Light
                </button>
                <button
                  onClick={() => dispatch({ type: "SET_THEME", payload: "system" })}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors ${
                    state.theme === "system"
                      ? "bg-accent/20 text-accent border border-accent/30"
                      : "bg-[var(--border)] text-text-secondary hover:text-text-primary border border-transparent"
                  }`}
                >
                  <Monitor size={14} />
                  System
                </button>
              </div>
            </div>

            <div className="border-t border-[var(--border)]" />

            {/* About */}
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-text-secondary/50 mb-2">About</p>
              <p className="text-sm text-text-secondary leading-relaxed">
                Image generation is powered by{" "}
                <span className="text-text-primary font-medium">Google Gemini</span>
                {" "}via Vertex AI, using a server-side service account. Images are stored locally on this device only.
              </p>
            </div>

            <div className="border-t border-[var(--border)]" />

            {/* Data */}
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-text-secondary/50 mb-3">Data</p>
              <div className="flex gap-2 rounded-xl bg-white/[0.03] p-3 border border-[var(--border)]">
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--border)] py-2.5 text-sm text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40"
                >
                  <Download size={14} />
                  {exporting ? "Exporting..." : "Export"}
                </button>
                <button
                  onClick={() => importRef.current?.click()}
                  disabled={importStatus === "importing"}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm transition-colors ${
                    importStatus === "done"
                      ? "bg-accent/20 text-accent"
                      : importStatus === "error"
                      ? "bg-red-500/20 text-red-400"
                      : "bg-[var(--border)] text-text-secondary hover:text-text-primary"
                  } disabled:opacity-40`}
                >
                  {importStatus === "done" ? <Check size={14} /> : <Upload size={14} />}
                  {importStatus === "importing"
                    ? "Importing..."
                    : importStatus === "done"
                    ? importResult
                      ? `Imported ${importResult.imported} image${importResult.imported !== 1 ? "s" : ""}`
                      : "Done"
                    : importStatus === "error"
                    ? "Failed"
                    : "Import"}
                </button>
                <input ref={importRef} type="file" accept=".zip" className="hidden" onChange={handleImport} />
              </div>
              {importStatus === "error" && importError && (
                <p className="text-xs text-red-400 mt-2">{importError}</p>
              )}
              {importStatus === "done" && importResult && importResult.skipped > 0 && (
                <p className="text-xs text-text-secondary/50 mt-2">{importResult.skipped} image{importResult.skipped !== 1 ? "s" : ""} could not be imported.</p>
              )}
              {!importStatus && <p className="text-xs text-text-secondary/40 mt-2">Export your images as a ZIP, then import on another device or instance.</p>}
            </div>

            <div className="border-t border-[var(--border)]" />

            {/* Developer */}
            <div>
              <button
                onClick={() => setDevOpen((v) => !v)}
                className="flex w-full items-center justify-between"
              >
                <p className="text-xs font-medium uppercase tracking-wider text-text-secondary/50">Developer</p>
                <ChevronDown
                  size={13}
                  className="text-text-secondary/40 transition-transform duration-200"
                  style={{ transform: devOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                />
              </button>

              <AnimatePresence>
                {devOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-text-primary">Console tools</p>
                          <p className="text-xs text-text-secondary/50 mt-0.5">Mobile browser DevTools (Eruda)</p>
                        </div>
                        <button
                          onClick={handleDevToolsToggle}
                          className={`relative h-6 w-11 rounded-full transition-colors ${devTools ? "bg-accent" : "bg-[var(--border)]"}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${devTools ? "translate-x-5" : "translate-x-0"}`} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-text-primary">React dev overlay</p>
                          <p className="text-xs text-text-secondary/50 mt-0.5">Error and warning badge</p>
                        </div>
                        <button
                          onClick={handleDevOverlayToggle}
                          className={`relative h-6 w-11 rounded-full transition-colors ${devOverlay ? "bg-accent" : "bg-[var(--border)]"}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${devOverlay ? "translate-x-5" : "translate-x-0"}`} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-text-primary">Elapsed time on cards</p>
                          <p className="text-xs text-text-secondary/50 mt-0.5">Show live timer on generation cards</p>
                        </div>
                        <button
                          onClick={handleElapsedTimeToggle}
                          className={`relative h-6 w-11 rounded-full transition-colors ${showElapsedTime ? "bg-accent" : "bg-[var(--border)]"}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${showElapsedTime ? "translate-x-5" : "translate-x-0"}`} />
                        </button>
                      </div>
                      {reloadPending && (
                        <p className="text-xs text-text-secondary/50">Reload the page to apply changes</p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={() => {
                dispatch({ type: "TOGGLE_SETTINGS" });
                if (reloadPending) window.location.reload();
              }}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-accent-hover"
            >
              {reloadPending ? "Save & Reload" : "Close"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
