"use client";

import { useState, useEffect, useRef, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Download, Maximize2, Copy, Check, Trash2, Wand2, ImagePlus, MoreVertical, ChevronRight } from "lucide-react";
import type { GeneratedImageMeta, Workspace } from "@/lib/types";
import { MODELS } from "@/lib/types";
import { copyText } from "@/lib/uuid";
import DeleteConfirmModal from "./DeleteConfirmModal";

interface ImageCardProps {
  image: GeneratedImageMeta;
  index: number;
  onPromptSelect?: (prompt: string) => void;
  onRestore?: (image: GeneratedImageMeta) => void;
  onReference?: (image: GeneratedImageMeta) => void;
  isSelected?: boolean;
  onSelect?: (id: string, selected: boolean, shift?: boolean) => void;
  batchMode?: boolean;
  onExpand?: (id: string) => void;
  // Passed from Gallery to avoid ImageCard calling useApp() directly.
  // useApp() inside a memo'd component subscribes it to the entire context,
  // causing all visible cards to re-render on every state change.
  otherWorkspaces?: Workspace[];
  onRemoveFromView?: (id: string) => void;
  onDeleteImage?: (id: string) => void;
}

function ImageCard({ image, index, onPromptSelect, onRestore, onReference, isSelected = false, onSelect, batchMode, onExpand, otherWorkspaces = [], onRemoveFromView, onDeleteImage }: ImageCardProps) {
  const [copied, setCopied] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [subMenu, setSubMenu] = useState<null | "copy" | "move">(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [subMenuPos, setSubMenuPos] = useState({ x: 0, y: 0 });
  const [menuRight, setMenuRight] = useState(0);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);

  // Prefer server URL (new model), fall back to inline base64 (legacy IndexedDB data)
  const thumbnailSrc = image.thumbnailUrl
    ? image.thumbnailUrl
    : image.thumbnailBase64
      ? `data:image/jpeg;base64,${image.thumbnailBase64}`
      : "";
  const [thumbSrc, setThumbSrc] = useState(thumbnailSrc);
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumbRetries = useRef(0);
  const modelLabel = MODELS.find((m) => m.id === image.model)?.label ?? image.model;

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

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await copyText(image.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    onPromptSelect?.(image.prompt);
  };

  const handleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    onExpand?.(image.id);
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (batchMode && onSelect) {
      onSelect(image.id, !isSelected, e.shiftKey);
      return;
    }
    onExpand?.(image.id);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteModalOpen(true);
  };

  const handleRestoreOverlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRestore?.(image);
  };

  const handleReference = (e: React.MouseEvent) => {
    e.stopPropagation();
    onReference?.(image);
  };

  const handleMenuOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (moreButtonRef.current) {
      const rect = moreButtonRef.current.getBoundingClientRect();
      setMenuPos({ x: rect.right, y: rect.bottom });
    }
    setMenuOpen((v) => !v);
    setSubMenu(null);
  };

  const handleSubMenuTrigger = (type: "copy" | "move", e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const panelRect = menuPanelRef.current?.getBoundingClientRect();
    setSubMenuPos({ x: rect.left, y: rect.top });
    setMenuRight(panelRect?.right ?? menuPos.x);
    setSubMenu(type);
  };

  const handleCopyTo = async (e: React.MouseEvent, targetWorkspaceId: string) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/images/${image.id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetWorkspaceId }),
      });
      if (!res.ok) {
        console.error(`[ImageCard] Copy failed: ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      console.error("[ImageCard] Copy request failed:", err);
    }
    setMenuOpen(false);
    setSubMenu(null);
  };

  const handleMoveTo = async (e: React.MouseEvent, targetWorkspaceId: string) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/images/${image.id}/workspace`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: targetWorkspaceId }),
      });
      if (res.ok) {
        onRemoveFromView?.(image.id);
      } else {
        console.error(`[ImageCard] Move failed: ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      console.error("[ImageCard] Move request failed:", err);
    }
    setMenuOpen(false);
    setSubMenu(null);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => { setMenuOpen(false); setSubMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const handleThumbError = useCallback(() => {
    // base64 data URLs don't benefit from network retries
    if (!image.thumbnailUrl || thumbRetries.current >= 3) {
      setThumbFailed(true);
      if (image.thumbnailUrl) {
        fetch(`/api/images/${image.id}/load-error`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "thumbnail" }),
        }).catch(() => {});
      }
      return;
    }
    thumbRetries.current += 1;
    setTimeout(
      () => setThumbSrc(`${image.thumbnailUrl}?_r=${thumbRetries.current}`),
      thumbRetries.current * 1500,
    );
  }, [image.thumbnailUrl, image.id]);

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
        onClick={handleCardClick}
      >
        {!thumbFailed && thumbSrc ? (
          <img src={thumbSrc} alt={image.prompt} className="block h-full w-full object-cover" draggable={false}
            onError={handleThumbError}
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

        {/* Restore to prompt — top-right, always visible on mobile, hover-reveal on desktop */}
        {onRestore && (
          <button
            onClick={handleRestoreOverlay}
            data-hover-only
          className={`absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-lg bg-black/40 text-white/70 backdrop-blur-sm transition-all hover:bg-black/60 hover:text-white ${menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            title="Restore to prompt"
          >
            <Wand2 size={12} />
          </button>
        )}

        {/* More options — always visible on mobile, hover-reveal on desktop */}
        <button
          ref={moreButtonRef}
          onClick={handleMenuOpen}
          data-hover-only
          className={`absolute ${onRestore ? "top-9" : "top-2"} right-2 z-10 flex h-6 w-6 items-center justify-center rounded-lg bg-black/40 text-white/70 backdrop-blur-sm transition-all hover:bg-black/60 hover:text-white ${menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          title="More options"
        >
          <MoreVertical size={12} />
        </button>

        <div className={`absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent transition-opacity duration-200 pointer-events-none sm:pointer-events-auto ${menuOpen ? "opacity-100 sm:opacity-100" : "opacity-0 sm:group-hover:opacity-100"}`}>
          <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
            <p className="flex-1 min-w-0 truncate text-xs text-white/70">{image.prompt}</p>
            <div className="flex items-center gap-1 shrink-0">
              <span className="hidden [@container(min-width:200px)]:inline-block rounded bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-white/55">{modelLabel}</span>
              <>
                  <button onClick={handleCopy} className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20" title="Copy prompt">
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                  <button onClick={handleDownload} className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20" title="Download">
                    <Download size={13} />
                  </button>
                  <button onClick={handleExpand} className="hidden [@container(min-width:200px)]:flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20" title="Expand">
                    <Maximize2 size={13} />
                  </button>
                  <button onClick={handleReference} className="hidden [@container(min-width:200px)]:flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/20" title="Use as reference image">
                    <ImagePlus size={13} />
                  </button>
                  <button onClick={handleDeleteClick} className="hidden [@container(min-width:120px)]:flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/80 backdrop-blur-sm transition-colors hover:bg-red-500/60" title="Delete">
                    <Trash2 size={13} />
                  </button>
                </>
            </div>
          </div>
        </div>
      </motion.div>

      {menuOpen && typeof document !== "undefined" && createPortal(
        <>
          {/* Click-away overlay */}
          <div
            className="fixed inset-0 z-[400]"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setSubMenu(null); }}
          />
          {/* Main dropdown */}
          <div
            ref={menuPanelRef}
            className="fixed z-[401] min-w-[140px] rounded-xl border border-[var(--border)] bg-surface-elevated shadow-xl py-1"
            style={{ right: window.innerWidth - menuPos.x, top: menuPos.y + 4 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onMouseEnter={(e) => handleSubMenuTrigger("copy", e)}
              onClick={(e) => handleSubMenuTrigger("copy", e)}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs text-text-primary hover:bg-[var(--border)] transition-colors ${subMenu === "copy" ? "bg-[var(--border)]" : ""}`}
            >
              Copy to <ChevronRight size={12} className="text-text-secondary/50" />
            </button>
            {otherWorkspaces.length > 0 && (
              <button
                onMouseEnter={(e) => handleSubMenuTrigger("move", e)}
                onClick={(e) => handleSubMenuTrigger("move", e)}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs text-text-primary hover:bg-[var(--border)] transition-colors ${subMenu === "move" ? "bg-[var(--border)]" : ""}`}
              >
                Move to <ChevronRight size={12} className="text-text-secondary/50" />
              </button>
            )}
            {otherWorkspaces.length === 0 && (
              <p className="px-3 py-2 text-xs text-text-secondary/50">No other collections</p>
            )}
          </div>
          {/* Flyout submenu */}
          {subMenu && (() => {
            const fitsRight = window.innerWidth - menuRight >= 140;
            return (
              <div
                className="fixed z-[402] min-w-[140px] rounded-xl border border-[var(--border)] bg-surface-elevated shadow-xl py-1"
                style={fitsRight
                  ? { left: menuRight, top: subMenuPos.y }
                  : { right: window.innerWidth - subMenuPos.x, top: subMenuPos.y }
                }
                onClick={(e) => e.stopPropagation()}
                onMouseLeave={() => setSubMenu(null)}
              >
                <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/50">Workspaces</p>
                <div className="border-t border-[var(--border)] mb-1" />
                {otherWorkspaces.map((ws) => (
                  <button
                    key={ws.id}
                    onClick={(e) => subMenu === "copy" ? handleCopyTo(e, ws.id) : handleMoveTo(e, ws.id)}
                    className="w-full text-left px-3 py-2 text-xs text-text-primary hover:bg-[var(--border)] transition-colors"
                  >
                    {ws.name}
                  </button>
                ))}
              </div>
            );
          })()}
        </>,
        document.body
      )}

      <DeleteConfirmModal
        open={deleteModalOpen}
        onConfirm={() => {
          onDeleteImage?.(image.id);
          setDeleteModalOpen(false);
        }}
        onCancel={() => setDeleteModalOpen(false)}
      />
    </>
  );
}

export default memo(ImageCard);
