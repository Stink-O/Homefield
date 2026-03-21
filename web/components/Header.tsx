"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, ChevronDown, Plus, Check, Layers, X, Trash2, Pencil, BookOpen, LogOut, Lock, Globe, MoreVertical } from "lucide-react";
import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useSession, signOut } from "next-auth/react";
import { useApp } from "@/contexts/AppContext";
import { randomUUID } from "@/lib/uuid";
import type { RowHeightIndex, Workspace } from "@/lib/types";

interface HeaderProps {
  onOpenTemplate?: () => void;
  isSharedMode?: boolean;
  promptSetterRef?: React.RefObject<((p: string) => void) | null>;
  onPromptSelect?: (p: string) => void;
}

export default function Header({ onOpenTemplate, isSharedMode }: HeaderProps) {
  const { state, dispatch } = useApp();
  const { data: session } = useSession();
  const [sliderValue, setSliderValue] = useState(state.rowHeightIndex);
  const [, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentWorkspace = state.workspaces.find((ws) => ws.id === state.currentWorkspaceId);

  const username = session?.user?.name ?? "";
  const userRole = (session?.user as { role?: string } | undefined)?.role ?? "";

  // Pending registration count for admin notification badge
  const [pendingCount, setPendingCount] = useState(0);
  const fetchPending = useCallback(() => {
    if (userRole !== "admin") return;
    fetch("/api/admin/pending-count")
      .then((r) => r.ok ? r.json() : { count: 0 })
      .then(({ count }) => setPendingCount(count))
      .catch(() => {});
  }, [userRole]);
  useEffect(() => {
    fetchPending();
    const interval = setInterval(fetchPending, 30_000);
    return () => clearInterval(interval);
  }, [fetchPending]);

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

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value) as RowHeightIndex;
    setSliderValue(value);
    startTransition(() => {
      dispatch({ type: "SET_ROW_HEIGHT", payload: value });
    });
  };

  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const mobileMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mobileMoreOpen) return;
    function handleClick(e: MouseEvent) {
      if (mobileMoreRef.current && !mobileMoreRef.current.contains(e.target as Node)) {
        setMobileMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [mobileMoreOpen]);

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
    <style>{`
      @keyframes liveDot {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.25; transform: scale(0.7); }
      }
    `}</style>
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--border)]"
      style={{ background: "var(--surface)" }}
      suppressHydrationWarning
    >
      <div className="flex h-14 sm:h-16 items-center px-4 sm:px-6">

        {/* Left: Logo + workspace OR shared label */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Image
            src="/logo-header.png"
            alt="HomeField"
            width={52}
            height={52}
            className="rounded-xl w-9 h-9 sm:w-[52px] sm:h-[52px] shrink-0"
          />
          <span className="hidden lg:inline text-xl font-bold tracking-tight text-text-primary">
            HomeField
          </span>
          <span className="hidden xl:inline-block text-[11px] font-medium uppercase tracking-widest text-text-secondary">
            Studio
          </span>

          {/* Workspace dropdown — private mode only */}
          {!isSharedMode && (
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
          )}

          {/* Shared space label */}
          {isSharedMode && (
            <div className="ml-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 sm:px-3 bg-amber-500/12 border border-amber-500/25">
              <span
                className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
                style={{ animation: "liveDot 2.4s ease-in-out infinite" }}
              />
              <span className="text-sm font-medium text-amber-500 hidden sm:inline">Shared Space</span>
              <span className="text-sm font-medium text-amber-500 sm:hidden">Shared</span>
            </div>
          )}
        </div>

        {/* Left spacer */}
        <div className="flex-1" />

        {/* Center: mode toggle + templates */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Compact icon toggle — below lg */}
          <div className="lg:hidden flex items-center rounded-lg border border-[var(--border)] overflow-hidden" suppressHydrationWarning>
            <Link
              href="/"
              className={`flex items-center justify-center h-8 w-8 transition-all ${
                !isSharedMode ? "bg-[var(--border)] text-text-primary" : "text-text-secondary/40 hover:text-text-secondary"
              }`}
              title="Private"
            >
              <Lock size={13} />
            </Link>
            <Link
              href="/shared"
              className={`flex items-center justify-center h-8 w-8 transition-all ${
                isSharedMode ? "bg-amber-500/15 text-amber-500" : "text-text-secondary/40 hover:text-text-secondary"
              }`}
              title="Shared"
            >
              <Globe size={13} />
            </Link>
          </div>

          {/* Template icon — xs only (mobile) */}
          {onOpenTemplate && (
            <button
              onClick={onOpenTemplate}
              className="sm:hidden relative flex items-center justify-center h-9 w-9 rounded-xl text-text-secondary transition-colors hover:text-text-primary"
              aria-label="Templates"
            >
              <BookOpen size={18} />
              <span
                className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#a3e635]"
                style={{ animation: "liveDot 2.4s ease-in-out infinite" }}
              />
            </button>
          )}

          {/* Template full button — sm to lg */}
          {onOpenTemplate && (
            <button
              onClick={onOpenTemplate}
              className="hidden sm:flex lg:hidden items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium text-text-primary/80 transition-all duration-150 hover:text-text-primary hover:bg-[#a3e635]/8"
              style={{ border: "1px solid rgba(163,230,53,0.28)" }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full bg-[#a3e635] shrink-0"
                style={{ animation: "liveDot 2.4s ease-in-out infinite" }}
              />
              Templates
              <span className="text-[9px] font-semibold uppercase tracking-widest text-[#a3e635]/55">new</span>
            </button>
          )}

          {/* Full text toggle + templates — lg+ */}
          <div className="hidden lg:flex items-center gap-1 rounded-xl p-1" style={{ background: "var(--chrome-surface)" }}>
            <Link
              href="/"
              className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all duration-150 ${
                !isSharedMode
                  ? "text-text-primary bg-[var(--border)]"
                  : "text-text-secondary/60 hover:text-text-secondary"
              }`}
            >
              <Lock size={11} />
              Private
            </Link>
            <Link
              href="/shared"
              className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all duration-150 ${
                isSharedMode
                  ? "text-amber-500 bg-amber-500/15"
                  : "text-text-secondary/60 hover:text-text-secondary hover:bg-amber-500/5"
              }`}
            >
              <Globe size={11} />
              Shared
            </Link>
            {onOpenTemplate && (
              <div className="flex items-center">
                <div className="w-px h-4 bg-[var(--border)] mx-1" />
                <button
                  onClick={onOpenTemplate}
                  className="flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium text-text-primary/80 transition-all duration-150 hover:text-text-primary hover:bg-[#a3e635]/8"
                  style={{ border: "1px solid rgba(163,230,53,0.28)" }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-[#a3e635] shrink-0"
                    style={{ animation: "liveDot 2.4s ease-in-out infinite" }}
                  />
                  Templates
                  <span className="text-[9px] font-semibold uppercase tracking-widest text-[#a3e635]/55">new</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right spacer */}
        <div className="flex-1" />

        {/* Right: controls + user */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Gallery size slider — lg+ */}
          <input
            type="range"
            min={0}
            max={4}
            step={1}
            value={sliderValue}
            onChange={handleSliderChange}
            className="gallery-slider w-24 hidden lg:block"
            title="Gallery size"
          />

          {/* User pill + sign-out — xl+ only */}
          {username && (
            <div className="hidden xl:flex items-center gap-2">
              {userRole === "admin" && (
                <Link
                  href="/admin"
                  className="relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-amber-400 bg-amber-400/10 border border-amber-400/25 hover:bg-amber-400/20 hover:border-amber-400/50 transition-all duration-150"
                  title="Admin panel"
                >
                  Admin
                  {pendingCount > 0 && (
                    <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-black leading-none shrink-0">
                      {pendingCount > 9 ? "9+" : pendingCount}
                    </span>
                  )}
                </Link>
              )}
              <Link
                href="/account"
                className="text-sm font-medium text-text-secondary/80 hover:text-text-primary transition-colors max-w-[120px] truncate"
                title="Account settings"
              >
                {username}
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex h-8 w-8 items-center justify-center rounded-xl text-text-secondary/60 transition-colors hover:text-red-400 hover:bg-red-500/8"
                title="Sign out"
              >
                <LogOut size={15} />
              </button>
            </div>
          )}

          {/* Settings button — always visible sm+ */}
          <motion.button
            whileHover={{ rotate: 90 }}
            transition={{ duration: 0.3 }}
            onClick={() => dispatch({ type: "TOGGLE_SETTINGS" })}
            className="hidden sm:flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl text-text-secondary transition-colors hover:text-text-primary"
          >
            <Settings size={20} />
          </motion.button>

          {/* Overflow more menu — visible below xl */}
          <div className="xl:hidden relative" ref={mobileMoreRef}>
            <button
              onClick={() => setMobileMoreOpen((v) => !v)}
              className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${mobileMoreOpen ? "bg-[var(--border)] text-text-primary" : "text-text-secondary hover:text-text-primary"}`}
              title="More"
            >
              {pendingCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
              )}
              <MoreVertical size={18} />
            </button>
            {mobileMoreOpen && (
              <div className="absolute right-0 top-full mt-1 z-[200] w-52 rounded-xl border border-[var(--border)] bg-surface-elevated shadow-xl py-1">
                <button
                  onClick={() => { dispatch({ type: "TOGGLE_SETTINGS" }); setMobileMoreOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-text-primary hover:bg-[var(--border)] transition-colors"
                >
                  <Settings size={14} /> Settings
                </button>
                {userRole === "admin" && (
                  <Link
                    href="/admin"
                    onClick={() => setMobileMoreOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-amber-400 hover:bg-[var(--border)] transition-colors"
                  >
                    <span className="flex-1">Admin</span>
                    {pendingCount > 0 && (
                      <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-black leading-none shrink-0">
                        {pendingCount > 9 ? "9+" : pendingCount}
                      </span>
                    )}
                  </Link>
                )}
                {username && (
                  <Link
                    href="/account"
                    onClick={() => setMobileMoreOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-text-secondary hover:bg-[var(--border)] transition-colors"
                  >
                    <span className="truncate">{username}</span>
                  </Link>
                )}
                <div className="border-t border-[var(--border)] my-1" />
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-400 hover:bg-[var(--border)] transition-colors"
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.header>

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
                <h2 className="text-base font-semibold text-text-primary">Delete "{deleteTarget.name}"?</h2>
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
                Give "{renameTarget.name}" a new name.
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
