"use client";

import { memo, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Download, Copy, Check, Trash2, ImagePlus, Maximize2, MoreVertical, ChevronRight, Wand2 } from "lucide-react";
import { createPortal } from "react-dom";
import DeleteConfirmModal from "../DeleteConfirmModal";
import { MODELS, normalizeModelId, type GeneratedImageMeta, type Workspace } from "@/lib/types";
import { copyText } from "@/lib/uuid";

// ── Shared card — matches ImageCard layout exactly ────────────────────────────

interface SharedCardProps {
  image: GeneratedImageMeta;
  index: number;
  isOwn: boolean;
  isAdmin: boolean;
  workspaces: Workspace[];
  onExpand: () => void;
  onDelete?: (id: string) => void;
  onReference?: (image: GeneratedImageMeta) => void;
  onRestore?: (image: GeneratedImageMeta) => void;
  onPromptSelect?: (prompt: string) => void;
  isSelected?: boolean;
  onSelect?: (id: string, selected: boolean, shift?: boolean) => void;
  batchMode?: boolean;
}

const SharedCard = memo(function SharedCard({
  image, index, isOwn, isAdmin, workspaces, onExpand, onDelete, onReference, onRestore, onPromptSelect, isSelected = false, onSelect, batchMode,
}: SharedCardProps) {
  const [copied, setCopied] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  const thumbnailSrc = image.thumbnailUrl
    ? image.thumbnailUrl
    : image.thumbnailBase64
      ? `data:image/jpeg;base64,${image.thumbnailBase64}`
      : "";
  const modelLabel = MODELS.find((m) => m.id === normalizeModelId(image.model))?.label ?? image.model;
  const canDelete = isOwn || isAdmin;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await copyText(image.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    onPromptSelect?.(image.prompt);
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const res = await fetch(`/api/images/${image.id}/download`);
    if (!res.ok) return;
    const blob = await res.blob();
    const slug = image.prompt.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "_");
    const ext = image.mimeType === "image/jpeg" ? "jpg" : "png";
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `homefield_${slug}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  };

  const handleReference = (e: React.MouseEvent) => {
    e.stopPropagation();
    onReference?.(image);
  };

  const handleRestore = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRestore?.(image);
  };

  const handleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    onExpand();
  };

  const handleMenuOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (moreButtonRef.current) {
      const rect = moreButtonRef.current.getBoundingClientRect();
      setMenuPos({ x: rect.right, y: rect.bottom });
    }
    setMenuOpen((v) => !v);
  };

  const handleSaveTo = async (e: React.MouseEvent, workspaceId: string) => {
    e.stopPropagation();
    await fetch(`/api/shared/images/${image.id}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    setMenuOpen(false);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0, scale: isSelected ? 0.94 : 1 }}
        transition={{
          opacity: { duration: 0.35, delay: Math.min(index * 0.05, 0.3), ease: [0.23, 1, 0.32, 1] },
          y: { duration: 0.35, delay: Math.min(index * 0.05, 0.3), ease: [0.23, 1, 0.32, 1] },
          scale: { duration: 0.15, ease: [0.23, 1, 0.32, 1] },
        }}
        className="@container group relative cursor-pointer overflow-hidden w-full h-full"
        onClick={(e) => {
          if (batchMode && onSelect) {
            onSelect(image.id, !isSelected, e.shiftKey);
            return;
          }
          onExpand();
        }}
      >
        {thumbnailSrc ? (

          <img src={thumbnailSrc} alt={image.prompt} className="block h-full w-full object-cover" draggable={false}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-white/5">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/20"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </div>
        )}

        {isSelected && <div className="absolute inset-0 bg-accent/20 pointer-events-none" />}

        {/* Batch select checkbox — top-left, visible on hover or when selected */}
        {onSelect && (
          <button
            onClick={(e) => { e.stopPropagation(); onSelect(image.id, !isSelected, e.shiftKey); }}
            className={`absolute top-2 left-2 z-10 flex h-5 w-5 items-center justify-center rounded transition-all ${
              isSelected
                ? "opacity-100 bg-accent border-2 border-accent"
                : "opacity-0 group-hover:opacity-100 bg-black/40 border-2 border-white/60 backdrop-blur-sm"
            }`}
            title={isSelected ? "Deselect" : "Select"}
          >
            {isSelected && <Check size={11} className="text-black" strokeWidth={3} />}
          </button>
        )}

        {/* Restore to prompt — desktop only, hover-reveal */}
        {onRestore && (
          <button
            onClick={handleRestore}
            data-hover-only
            className={`absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-lg bg-black/40 text-white/70 backdrop-blur-sm transition-all hover:bg-black/60 hover:text-white ${menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            title="Restore to prompt"
          >
            <Wand2 size={12} />
          </button>
        )}

        {/* More options button — desktop only, hover-reveal */}
        <button
          ref={moreButtonRef}
          onClick={handleMenuOpen}
          data-hover-only
          className={`absolute ${onRestore ? "top-9" : "top-2"} right-2 z-10 flex h-6 w-6 items-center justify-center rounded-lg bg-black/40 text-white/70 backdrop-blur-sm transition-all hover:bg-black/60 hover:text-white ${menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          title="More options"
        >
          <MoreVertical size={12} />
        </button>

        {/* Bottom gradient overlay — same structure as ImageCard */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none sm:pointer-events-auto">
          <div className="absolute bottom-3 left-3 right-3 overflow-hidden flex items-end justify-between gap-2">
            {/* Left: username + prompt */}
            <div className="flex-1 min-w-0 flex flex-col gap-0.5 overflow-hidden">
              {image.username && (
                <span className="text-[9px] font-medium text-amber-300/70 leading-none">{image.username}</span>
              )}
              <p className="truncate text-xs text-white/70">{image.prompt}</p>
            </div>
            {/* Right: actions */}
            <div className="flex items-center gap-1 shrink-0">
              <span className="hidden [@container(min-width:280px)]:inline-block rounded bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-white/55">
                {modelLabel}
              </span>
              <button onClick={handleCopy} className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20" title="Copy prompt">
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
              <button onClick={handleDownload} className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20" title="Download">
                <Download size={13} />
              </button>
              <button onClick={handleExpand} className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20" title="Expand">
                <Maximize2 size={13} />
              </button>
              <button onClick={handleReference} className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20" title="Use as reference">
                <ImagePlus size={13} />
              </button>
              {canDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteModalOpen(true); }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-red-500/60"
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {menuOpen && typeof document !== "undefined" && createPortal(
        <>
          <div
            className="fixed inset-0 z-[400]"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }}
          />
          <div
            className="fixed z-[401] min-w-[160px] rounded-xl border border-[var(--border)] bg-surface-elevated shadow-xl py-1"
            style={{ right: window.innerWidth - menuPos.x, top: menuPos.y + 4 }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/50">
              Save to collection
            </p>
            <div className="border-t border-[var(--border)] mb-1" />
            {workspaces.length === 0 ? (
              <p className="px-3 py-2 text-xs text-text-secondary/50">No workspaces</p>
            ) : (
              workspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={(e) => handleSaveTo(e, ws.id)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs text-text-primary hover:bg-[var(--border)] transition-colors"
                >
                  {ws.name}
                  <ChevronRight size={11} className="text-text-secondary/40" />
                </button>
              ))
            )}
          </div>
        </>,
        document.body
      )}

      <DeleteConfirmModal
        open={deleteModalOpen}
        onConfirm={() => { onDelete?.(image.id); setDeleteModalOpen(false); }}
        onCancel={() => setDeleteModalOpen(false)}
      />
    </>
  );
});

export default SharedCard;
