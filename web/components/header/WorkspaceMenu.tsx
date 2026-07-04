"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Plus, Check, Layers, X, Trash2, Pencil } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useApp } from "@/contexts/AppContext";
import { randomUUID } from "@/lib/uuid";
import type { Workspace } from "@/lib/types";

// Workspace switcher dropdown plus the create/rename/delete modals and the
// info toasts they raise. Only rendered in private mode.
export default function WorkspaceMenu() {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentWorkspace = state.workspaces.find((ws) => ws.id === state.currentWorkspaceId);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; count: number } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameName, setRenameName] = useState("");
  const [infoToasts, setInfoToasts] = useState<{ id: string; message: string }[]>([]);

  const handleDeleteClick = async (ws: Workspace) => {
    setOpen(false);
    // Count images via API instead of IndexedDB
    try {
      const res = await fetch(`/api/images?workspaceId=${ws.id}&limit=10000`);
      const data = res.ok ? await res.json() : { items: [] };
      setDeleteTarget({ id: ws.id, name: ws.name, count: (data.items ?? []).length });
    } catch {
      setDeleteTarget({ id: ws.id, name: ws.name, count: 0 });
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    dispatch({ type: "DELETE_WORKSPACE", payload: deleteTarget.id });
    setDeleteTarget(null);
    try {
      const res = await fetch(`/api/workspaces/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json() as { success: boolean; movedToMain?: number };
        if (data.movedToMain && data.movedToMain > 0) {
          const toastId = randomUUID();
          const n = data.movedToMain;
          const message = `Workspace deleted. ${n} ${n === 1 ? "image" : "images"} moved to your main workspace.`;
          setInfoToasts((prev) => [...prev, { id: toastId, message }]);
          setTimeout(() => setInfoToasts((prev) => prev.filter((t) => t.id !== toastId)), 6000);
        }
      }
    } catch { /* network error — deletion already dispatched to local state */ }
  };

  const handleRenameClick = (ws: Workspace) => {
    setOpen(false);
    setRenameName(ws.name);
    setRenameTarget({ id: ws.id, name: ws.name });
  };

  const handleRenameConfirm = async () => {
    if (!renameTarget || !renameName.trim()) return;
    dispatch({ type: "RENAME_WORKSPACE", payload: { id: renameTarget.id, name: renameName.trim() } });
    fetch(`/api/workspaces/${renameTarget.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameName.trim() }),
    }).catch(() => {});
    setRenameTarget(null);
    setRenameName("");
  };

  const openModal = () => { setOpen(false); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setNewName(""); };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    closeModal();
    // Let the server own the ID so what the client stores is guaranteed to match the DB.
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (!res?.ok) return;
    const ws: Workspace = await res.json();
    dispatch({ type: "CREATE_WORKSPACE", payload: ws });
  };

  return (
    <>
    <div className="relative ml-0.5 sm:ml-2" ref={dropdownRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-[var(--border)] transition-colors"
        suppressHydrationWarning
      >
        {currentWorkspace?.name ?? "Main"}
        <ChevronDown size={13} className="text-text-secondary" />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[160px] rounded-xl border border-[var(--border)] bg-surface-elevated shadow-xl py-1">
          {state.workspaces.map((ws) => (
            <div
              key={ws.id}
              onClick={() => { dispatch({ type: "SWITCH_WORKSPACE", payload: ws.id }); setOpen(false); }}
              className="group flex items-center px-3 py-2 hover:bg-[var(--border)] transition-colors cursor-pointer"
            >
              <span className={`flex-1 text-sm text-left ${ws.id === state.currentWorkspaceId ? "text-accent" : "text-text-primary"}`}>
                {ws.name}
              </span>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {ws.id !== "main" && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRenameClick(ws); }}
                    className="opacity-0 group-hover:opacity-40 hover:!opacity-100 text-text-primary transition-opacity"
                    title="Rename workspace"
                  >
                    <Pencil size={11} />
                  </button>
                )}
                {ws.id !== "main" && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteClick(ws); }}
                    className="opacity-0 group-hover:opacity-40 hover:!opacity-100 text-text-primary transition-opacity"
                    title="Delete workspace"
                  >
                    <X size={12} />
                  </button>
                )}
                {ws.id === state.currentWorkspaceId && <Check size={12} className="text-accent" />}
              </div>
            </div>
          ))}

          <div className="border-t border-[var(--border)] mt-1 pt-1">
            <button
              onClick={openModal}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-[var(--border)] transition-colors"
            >
              <Plus size={13} />
              New workspace
            </button>
          </div>
        </div>
      )}
    </div>

    {/* Info toasts (e.g. workspace deletion moved images to main) */}
    {typeof document !== "undefined" && infoToasts.length > 0 && createPortal(
      <div className="fixed top-4 right-4 z-[300] flex flex-col gap-2 pointer-events-none">
        {infoToasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-center gap-3 rounded-xl border border-[var(--border)] bg-surface/95 backdrop-blur px-4 py-3 shadow-lg max-w-xs"
          >
            <div className="h-2 w-2 rounded-full bg-accent flex-shrink-0" />
            <span className="text-xs text-text-secondary leading-snug">{toast.message}</span>
            <button
              onClick={() => setInfoToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="ml-auto text-text-secondary/50 hover:text-text-primary transition-colors text-xs pl-2"
            >
              x
            </button>
          </div>
        ))}
      </div>,
      document.body
    )}

    {/* Delete workspace confirmation modal */}
    {typeof document !== "undefined" && createPortal(
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setDeleteTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 8 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="w-full max-w-sm mx-4 rounded-2xl border border-[var(--border)] bg-surface-elevated shadow-2xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-1">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/10">
                  <Trash2 size={16} className="text-red-400" />
                </div>
                <h2 className="text-base font-semibold text-text-primary">Delete &ldquo;{deleteTarget.name}&rdquo;?</h2>
              </div>

              <p className="text-xs text-text-secondary/60 leading-relaxed mb-5 ml-12">
                This will permanently delete the workspace and{" "}
                <span className="text-text-secondary font-medium">
                  {deleteTarget.count === 0
                    ? "all its contents"
                    : deleteTarget.count === 1
                    ? "1 generated image"
                    : `${deleteTarget.count} generated images`}
                </span>
                . This cannot be undone.
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--border)] py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  className="flex-1 rounded-xl bg-red-500 py-2 text-sm font-semibold text-white hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    )}

    {/* Rename workspace modal */}
    {typeof document !== "undefined" && createPortal(
      <AnimatePresence>
        {renameTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => { setRenameTarget(null); setRenameName(""); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 8 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="w-full max-w-sm mx-4 rounded-2xl border border-[var(--border)] bg-surface-elevated shadow-2xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-1">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10">
                  <Pencil size={16} className="text-accent" />
                </div>
                <h2 className="text-base font-semibold text-text-primary">Rename Workspace</h2>
              </div>

              <p className="text-xs text-text-secondary/60 leading-relaxed mb-5 ml-12">
                Give &ldquo;{renameTarget.name}&rdquo; a new name.
              </p>

              <input
                autoFocus
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--border)] px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary/40 outline-none focus:border-accent/40 transition-colors"
                placeholder="Workspace name..."
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameConfirm();
                  if (e.key === "Escape") { setRenameTarget(null); setRenameName(""); }
                }}
              />

              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => { setRenameTarget(null); setRenameName(""); }}
                  className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--border)] py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRenameConfirm}
                  disabled={!renameName.trim() || renameName.trim() === renameTarget.name}
                  className="flex-1 rounded-xl bg-accent py-2 text-sm font-semibold text-black transition-opacity disabled:opacity-30 hover:opacity-90"
                >
                  Rename
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    )}

    {/* New workspace modal */}
    {typeof document !== "undefined" && createPortal(
      <AnimatePresence>
        {modalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={closeModal}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 8 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="w-full max-w-sm mx-4 rounded-2xl border border-[var(--border)] bg-surface-elevated shadow-2xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-1">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10">
                  <Layers size={16} className="text-accent" />
                </div>
                <h2 className="text-base font-semibold text-text-primary">New Workspace</h2>
              </div>

              <p className="text-xs text-text-secondary/60 leading-relaxed mb-5 ml-12">
                Workspaces keep your generations separate. Use them to organise projects, clients, or creative directions.
              </p>

              <input
                autoFocus
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--border)] px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary/40 outline-none focus:border-accent/40 transition-colors"
                placeholder="e.g. Brand Assets, Concepts..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") closeModal();
                }}
              />

              <div className="flex gap-2 mt-3">
                <button
                  onClick={closeModal}
                  className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--border)] py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                  className="flex-1 rounded-xl bg-accent py-2 text-sm font-semibold text-black transition-opacity disabled:opacity-30 hover:opacity-90"
                >
                  Create
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    )}
    </>
  );
}
