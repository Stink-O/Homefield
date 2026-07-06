"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Download, Trash2, Copy, ArrowRightLeft, ChevronDown, CheckSquare } from "lucide-react";
import DeleteConfirmModal from "./DeleteConfirmModal";

interface BatchSelectBarProps {
  count: number;
  totalCount: number;
  onSelectAll: () => void;
  onDownload: () => void;
  onDelete: () => void;
  workspaces: { id: string; name: string }[];
  currentWorkspaceId: string;
  onCopyTo: (targetWorkspaceId: string) => void;
  onMoveTo: (targetWorkspaceId: string) => void;
  showMoveTo?: boolean;
}

// Responsive strategy: the bar sizes to its content (no max-width — with
// "Select all" present the full-label row is ~900px and must not be capped
// below that or it wraps badly). Below lg the "ESC to cancel" hint drops
// (keyboard-only advice); below md the button labels collapse to icons with
// aria-label/title so everything fits one row on phones. Centered flex-wrap
// is the graceful fallback if it ever does wrap.
export default function BatchSelectBar({
  count,
  totalCount,
  onSelectAll,
  onDownload,
  onDelete,
  workspaces,
  currentWorkspaceId,
  onCopyTo,
  onMoveTo,
  showMoveTo = true,
}: BatchSelectBarProps) {
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);

  const copyRef = useRef<HTMLDivElement>(null);
  const moveRef = useRef<HTMLDivElement>(null);

  const otherWorkspaces = workspaces.filter((ws) => ws.id !== currentWorkspaceId);

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!copyMenuOpen && !moveMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (copyRef.current && !copyRef.current.contains(e.target as Node)) {
        setCopyMenuOpen(false);
      }
      if (moveRef.current && !moveRef.current.contains(e.target as Node)) {
        setMoveMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [copyMenuOpen, moveMenuOpen]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10, transition: { duration: 0.12, ease: [0.4, 0, 1, 1], delay: 0 } }}
      transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1], delay: 0.18 }}
      className="fixed bottom-0 left-0 right-0 z-40 pb-16 px-4 pointer-events-none"
    >
      <div className="relative mx-auto max-w-full pointer-events-auto flex justify-center">
        <div className="relative glass-command rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-3.5 flex items-center justify-center gap-2 lg:gap-3 flex-wrap">
          <span className="text-sm font-medium text-text-secondary tabular-nums whitespace-nowrap">
            {count}<span className="hidden md:inline"> selected</span>
          </span>
          <div className="h-4 w-px bg-[var(--border)]" />
          {count < totalCount && (
            <button
              onClick={onSelectAll}
              aria-label={`Select all ${totalCount}`}
              className="flex items-center gap-1.5 rounded-xl bg-[var(--border)] px-3 lg:px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary whitespace-nowrap"
            >
              <CheckSquare size={14} />
              <span className="hidden md:inline">Select all</span>{totalCount}
            </button>
          )}
          <button
            onClick={onDownload}
            aria-label="Download selected"
            title="Download"
            className="flex items-center gap-1.5 rounded-xl bg-[var(--border)] px-3 lg:px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary whitespace-nowrap"
          >
            <Download size={14} />
            <span className="hidden md:inline">Download</span>
          </button>

          {otherWorkspaces.length > 0 && (
            <>
              {/* Copy to */}
              <div className="relative" ref={copyRef}>
                <button
                  onClick={() => { setCopyMenuOpen((v) => !v); setMoveMenuOpen(false); }}
                  aria-label="Copy to workspace"
                  title="Copy to"
                  className="flex items-center gap-1.5 rounded-xl bg-[var(--border)] px-3 lg:px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary whitespace-nowrap"
                >
                  <Copy size={14} />
                  <span className="hidden md:inline">Copy to</span>
                  <ChevronDown size={12} />
                </button>
                {copyMenuOpen && (
                  <div className="absolute bottom-full mb-2 left-0 z-50 min-w-[140px] rounded-xl border border-[var(--border)] bg-surface-elevated shadow-xl py-1">
                    {otherWorkspaces.map((ws) => (
                      <button
                        key={ws.id}
                        onClick={() => { onCopyTo(ws.id); setCopyMenuOpen(false); }}
                        className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-[var(--border)] transition-colors"
                      >
                        {ws.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Move to */}
              {showMoveTo && <div className="relative" ref={moveRef}>
                <button
                  onClick={() => { setMoveMenuOpen((v) => !v); setCopyMenuOpen(false); }}
                  aria-label="Move to workspace"
                  title="Move to"
                  className="flex items-center gap-1.5 rounded-xl bg-[var(--border)] px-3 lg:px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary whitespace-nowrap"
                >
                  <ArrowRightLeft size={14} />
                  <span className="hidden md:inline">Move to</span>
                  <ChevronDown size={12} />
                </button>
                {moveMenuOpen && (
                  <div className="absolute bottom-full mb-2 right-0 lg:right-auto lg:left-0 z-50 min-w-[140px] rounded-xl border border-[var(--border)] bg-surface-elevated shadow-xl py-1">
                    {otherWorkspaces.map((ws) => (
                      <button
                        key={ws.id}
                        onClick={() => { onMoveTo(ws.id); setMoveMenuOpen(false); }}
                        className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-[var(--border)] transition-colors"
                      >
                        {ws.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>}
            </>
          )}

          <button
            onClick={() => setDeleteModalOpen(true)}
            aria-label="Delete selected"
            title="Delete"
            className="flex items-center gap-1.5 rounded-xl bg-[var(--border)] px-3 lg:px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-red-500/20 hover:text-red-400 whitespace-nowrap"
          >
            <Trash2 size={14} />
            <span className="hidden md:inline">Delete</span>
          </button>

          <p className="hidden lg:block pl-1 text-xs text-text-secondary/50 pointer-events-none whitespace-nowrap">ESC to cancel</p>
        </div>
      </div>
      <DeleteConfirmModal
        open={deleteModalOpen}
        count={count}
        onConfirm={() => { onDelete(); setDeleteModalOpen(false); }}
        onCancel={() => setDeleteModalOpen(false)}
      />
    </motion.div>
  );
}
