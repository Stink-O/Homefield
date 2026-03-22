"use client";

import { useCallback, useLayoutEffect, useMemo, useState, useEffect, useRef, memo } from "react";
import { AnimatePresence } from "framer-motion";
import { motion } from "framer-motion";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Download, Copy, Check, Trash2, ImagePlus, Info, ChevronDown, SlidersHorizontal, Maximize2, MoreVertical, ChevronRight, Wand2 } from "lucide-react";
import type { Session } from "next-auth";
import ShimmerPlaceholder from "./ShimmerPlaceholder";
import BatchSelectBar from "./BatchSelectBar";
import DeleteConfirmModal from "./DeleteConfirmModal";
import ZoomModal from "./ZoomModal";
import { ROW_CONFIGS, MODELS, getAspectDimensions, type AspectRatio, type GeneratedImageMeta, type Workspace } from "@/lib/types";
import { useApp } from "@/contexts/AppContext";
import { copyText } from "@/lib/uuid";
import { createPortal } from "react-dom";

interface PendingGeneration {
  id: string;
  prompt: string;
  aspectRatio: string;
  count: number;
  startedAt: number;
  failed?: boolean;
  errorMessage?: string;
}

interface SharedGalleryProps {
  images: GeneratedImageMeta[];
  pending: PendingGeneration[];
  loading: boolean;
  session: Session | null;
  workspaces?: Workspace[];
  onDelete?: (id: string) => void;
  onReference?: (image: GeneratedImageMeta) => void;
  onRestore?: (image: GeneratedImageMeta) => void;
  onPromptSelect?: (prompt: string) => void;
  onCancel?: (pendingId: string) => void;
  onRetry?: (pendingId: string) => void;
  onBatchDelete?: (ids: string[]) => void;
  onBatchDownload?: (ids: string[]) => void;
  onBatchCopyTo?: (ids: string[], targetWorkspaceId: string) => void;
  onBatchModeChange?: (active: boolean) => void;
}

interface GalleryPhoto {
  src: string;
  width: number;
  height: number;
  key: string;
  alt: string;
  _image: GeneratedImageMeta | null;
  isPending: boolean;
  pendingId?: string;
  pendingPrompt?: string;
  pendingStartedAt?: number;
  pendingFailed?: boolean;
  pendingErrorMessage?: string;
}

interface RowPhoto extends GalleryPhoto {
  renderWidth: number;
  renderHeight: number;
  globalIndex: number;
}

interface GalleryRow {
  photos: RowPhoto[];
  height: number;
}

const SPACING = 6;
const PROMPT_TRUNCATE_LENGTH = 120;

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
  const modelLabel = MODELS.find((m) => m.id === image.model)?.label ?? image.model;
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
          // eslint-disable-next-line @next/next/no-img-element
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

// ── Shared lightbox ───────────────────────────────────────────────────────────

function SharedLightbox({
  image, isOwn, isAdmin, onClose, onPrev, onNext, onDelete, onReference, onRestore, onPromptSelect,
}: {
  image: GeneratedImageMeta;
  isOwn: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDelete?: (id: string) => void;
  onReference?: (image: GeneratedImageMeta) => void;
  onRestore?: (image: GeneratedImageMeta) => void;
  onPromptSelect?: (prompt: string) => void;
}) {
  const [copiedPanel, setCopiedPanel] = useState(false);
  const [seeAll, setSeeAll] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [refPreviewIndex, setRefPreviewIndex] = useState<number | null>(null);

  useEffect(() => {
    setSeeAll(false);
    setPromptExpanded(false);
    setCopiedPanel(false);
    setDeleteConfirm(false);
    setRefPreviewIndex(null);
  }, [image.id]);

  const imageSrc = `/api/images/${image.id}/download`;

  const modelLabel = MODELS.find((m) => m.id === image.model)?.label ?? image.model;
  const formattedDate = new Date(image.timestamp).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
  const isLongPrompt = image.prompt.length > PROMPT_TRUNCATE_LENGTH;
  const displayedPrompt = isLongPrompt && !promptExpanded ? image.prompt.slice(0, PROMPT_TRUNCATE_LENGTH) : image.prompt;
  const canDelete = isOwn || isAdmin;

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const res = await fetch(`/api/images/${image.id}/download`);
    if (!res.ok) return;
    const blob = await res.blob();
    const slug = image.prompt.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "_");
    const ext = image.mimeType === "image/jpeg" ? "jpg" : "png";
    const isMobile = navigator.maxTouchPoints > 0 && window.innerWidth < 768;
    if (isMobile && typeof navigator.canShare === "function") {
      try {
        const file = new File([blob], `homefield_${slug}.${ext}`, { type: image.mimeType });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
      } catch (err) { if ((err as Error).name === "AbortError") return; }
    }
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `homefield_${slug}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  };

  const handleCopyPanel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await copyText(image.prompt);
    setCopiedPanel(true);
    setTimeout(() => setCopiedPanel(false), 1500);
    onPromptSelect?.(image.prompt);
  };

  const handleCopyMobile = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await copyText(image.prompt);
    setCopiedPanel(true);
    setTimeout(() => setCopiedPanel(false), 1500);
    onPromptSelect?.(image.prompt);
    onClose();
  };

  const handleReferencePanel = (e: React.MouseEvent) => {
    e.stopPropagation();
    onReference?.(image);
    onClose();
  };

  const handleRestorePanel = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRestore?.(image);
    onClose();
  };

  const handleDeleteMobile = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    onDelete?.(image.id);
    onClose();
  };

  const handleDeletePanel = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    onDelete?.(image.id);
    onClose();
  };

  const infoPanel = (
    <>
      {/* Mobile action bar */}
      <div className="sm:hidden bg-surface px-6 py-5 rounded-t-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Author */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/20 text-sm font-semibold text-amber-500 shrink-0">
            {(image.username ?? "?")[0].toUpperCase()}
          </div>
          <div>
            <p className="text-[10px] text-text-secondary/60">Generated by</p>
            <p className="text-sm font-semibold text-text-primary">{image.username ?? "Unknown"}</p>
          </div>
        </div>

        {/* Row 1: primary actions */}
        <div className="flex justify-around mb-5">
          <button onClick={handleRestorePanel} className="flex flex-col items-center gap-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent">
              <Wand2 size={22} className="text-black" />
            </div>
            <span className="text-xs text-text-secondary/80 font-medium">Restore</span>
          </button>
          <button onClick={handleReferencePanel} className="flex flex-col items-center gap-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--border)]">
              <ImagePlus size={22} className="text-text-primary" />
            </div>
            <span className="text-xs text-text-secondary/80 font-medium">Reference</span>
          </button>
          <button onClick={handleDownload} className="flex flex-col items-center gap-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--border)]">
              <Download size={22} className="text-text-primary" />
            </div>
            <span className="text-xs text-text-secondary/80 font-medium">Download</span>
          </button>
        </div>

        {/* Row 2: secondary actions */}
        <div className="flex justify-around">
          <button onClick={handleCopyMobile} className="flex flex-col items-center gap-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--border)]">
              {copiedPanel ? <Check size={22} className="text-accent" /> : <Copy size={22} className="text-text-primary" />}
            </div>
            <span className="text-xs text-text-secondary/80 font-medium">Copy Prompt</span>
          </button>
          {canDelete && (
            <button onClick={handleDeleteMobile} className="flex flex-col items-center gap-2">
              <div className={`flex h-14 w-14 items-center justify-center rounded-2xl transition-colors ${deleteConfirm ? "bg-red-500" : "bg-[var(--border)]"}`}>
                <Trash2 size={22} className={deleteConfirm ? "text-white" : "text-red-400"} />
              </div>
              <span className="text-xs text-text-secondary/80 font-medium">{deleteConfirm ? "Confirm?" : "Delete"}</span>
            </button>
          )}
          <button onClick={() => setSeeAll((v) => !v)} className="flex flex-col items-center gap-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--border)]">
              <Info size={22} className={seeAll ? "text-accent" : "text-text-primary"} />
            </div>
            <span className="text-xs text-text-secondary/80 font-medium">Details</span>
          </button>
        </div>

        {/* Collapsible details */}
        <div className={`overflow-hidden transition-[max-height] duration-300 ease-in-out ${seeAll ? "max-h-[2000px] mt-4" : "max-h-0"}`}>
          <div className="pt-4 border-t border-[var(--border)]">
            <div className="bg-[var(--border)] rounded-xl p-3 mb-4">
              <p className="text-xs text-text-primary leading-relaxed">{displayedPrompt}</p>
            </div>
            <div>
              <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                <span className="text-xs text-text-secondary">By</span>
                <span className="text-xs text-text-primary font-semibold">{image.username ?? "Unknown"}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                <span className="text-xs text-text-secondary">Model</span>
                <span className="text-xs text-text-primary font-semibold">{modelLabel}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                <span className="text-xs text-text-secondary">Size</span>
                <span className="text-xs text-text-primary font-semibold">{image.width}×{image.height}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                <span className="text-xs text-text-secondary">Created</span>
                <span className="text-xs text-text-primary font-semibold">{formattedDate}</span>
              </div>
              {image.referenceImageDataUrls && image.referenceImageDataUrls.length > 0 && (
                <div className="flex justify-between items-start py-2">
                  <span className="text-xs text-text-secondary mt-1">References ({image.referenceImageDataUrls.length})</span>
                  <div className="flex flex-wrap gap-1 justify-end max-w-[60%]">
                    {image.referenceImageDataUrls.map((url, i) => (
                      <img key={i} src={url} alt={`Reference ${i + 1}`} className="h-8 w-8 rounded object-cover" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Desktop info panel */}
      <div className="hidden sm:flex w-72 h-full flex-shrink-0 flex-col overflow-y-auto bg-surface border-l border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 space-y-5 flex flex-col flex-1">

          {/* Author */}
          <div className="flex items-center gap-2.5 rounded-xl bg-amber-500/8 border border-amber-500/15 px-3 py-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/20 text-sm font-semibold text-amber-300 shrink-0">
              {(image.username ?? "?")[0].toUpperCase()}
            </div>
            <div>
              <p className="text-[10px] text-text-secondary/60 uppercase tracking-wide">Generated by</p>
              <p className="text-sm font-semibold text-text-primary">{image.username ?? "Unknown"}</p>
            </div>
          </div>

          {/* Prompt */}
          <div>
            <div className="flex items-center">
              <SlidersHorizontal size={11} className="text-text-secondary/50" />
              <span className="text-[10px] uppercase tracking-wide text-text-secondary/60 font-medium flex-1 ml-1.5">PROMPT</span>
              <button onClick={handleCopyPanel} className="rounded-md border border-[var(--border)] bg-[var(--border)] px-2 py-0.5 text-[10px] text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1">
                {copiedPanel ? <Check size={10} /> : <Copy size={10} />}
                {copiedPanel ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="bg-[var(--border)] rounded-xl p-3 mt-2">
              <p className="text-xs text-text-primary leading-relaxed">
                {displayedPrompt}
                {isLongPrompt && !promptExpanded && (
                  <> {"... "}<button onClick={() => setPromptExpanded(true)} className="text-text-secondary/50 hover:text-text-secondary transition-colors underline underline-offset-2">Show more</button></>
                )}
                {isLongPrompt && promptExpanded && (
                  <> {" "}<button onClick={() => setPromptExpanded(false)} className="text-text-secondary/50 hover:text-text-secondary transition-colors underline underline-offset-2">Show less</button></>
                )}
              </p>
            </div>
          </div>

          <div className="border-t border-[var(--border)]" />

          {/* Info */}
          <div>
            <div className="flex items-center mb-2">
              <Info size={11} className="text-text-secondary/50" />
              <span className="text-[10px] uppercase tracking-wide text-text-secondary/60 font-medium ml-1.5">INFORMATION</span>
            </div>
            <div>
              <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                <span className="text-xs text-text-secondary">Model</span>
                <span className="text-xs text-text-primary font-semibold text-right">{modelLabel}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                <span className="text-xs text-text-secondary">Quality</span>
                <span className="text-xs text-text-primary font-semibold text-right">{image.quality ?? "—"}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                <span className="text-xs text-text-secondary">Size</span>
                <span className="text-xs text-text-primary font-semibold text-right">{image.width}×{image.height}</span>
              </div>
              {seeAll && (
                <>
                  <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                    <span className="text-xs text-text-secondary">Aspect Ratio</span>
                    <span className="text-xs text-text-primary font-semibold text-right">{image.aspectRatio}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                    <span className="text-xs text-text-secondary">Created</span>
                    <span className="text-xs text-text-primary font-semibold text-right">{formattedDate}</span>
                  </div>
                  {image.referenceImageDataUrls && image.referenceImageDataUrls.length > 0 && (
                    <div className="flex justify-between items-start py-2 border-b border-[var(--border)]">
                      <span className="text-xs text-text-secondary mt-1">References ({image.referenceImageDataUrls.length})</span>
                      <div className="flex flex-wrap gap-1 justify-end max-w-[60%]">
                        {image.referenceImageDataUrls.map((url, i) => (
                          <img
                            key={i}
                            src={url}
                            alt={`Reference ${i + 1}`}
                            className="h-8 w-8 rounded object-cover cursor-pointer hover:ring-2 hover:ring-[var(--chrome-border-strong)] transition-all"
                            onClick={() => setRefPreviewIndex(i)}
                            title={`View reference ${i + 1}`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              <div className="flex justify-between items-center py-2 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setSeeAll((v) => !v)}>
                <span className="text-xs text-text-secondary">See all</span>
                <ChevronDown size={13} className="text-text-secondary transition-transform" style={{ transform: seeAll ? "rotate(180deg)" : "rotate(0deg)" }} />
              </div>
            </div>
          </div>

          <div className="mt-auto pt-4 border-t border-[var(--border)] flex flex-col gap-2">
            <button onClick={handleDownload} className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--border)] py-2 text-xs text-text-secondary hover:text-text-primary transition-colors">
              <Download size={13} />
              Download
            </button>
            <button onClick={handleReferencePanel} className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 py-2 text-xs font-medium text-amber-400 hover:bg-amber-500/20 transition-colors">
              <ImagePlus size={13} />
              Use as reference
            </button>
            <button onClick={handleRestorePanel} className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--border)] py-2 text-xs text-text-secondary hover:text-text-primary transition-colors">
              <Wand2 size={13} />
              Restore to prompt
            </button>
            {canDelete && (
              <button onClick={handleDeletePanel} className={`w-full flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-medium transition-colors ${deleteConfirm ? "bg-red-500 text-white hover:bg-red-600" : "bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20"}`}>
                <Trash2 size={13} />
                {deleteConfirm ? "Confirm delete" : "Delete"}
              </button>
            )}
          </div>

        </div>
      </div>
      {refPreviewIndex !== null && image.referenceImageDataUrls?.[refPreviewIndex] && (
        <ZoomModal
          src={image.referenceImageDataUrls[refPreviewIndex]}
          alt={`Reference image ${refPreviewIndex + 1}`}
          onClose={() => setRefPreviewIndex(null)}
          caption={`Reference ${refPreviewIndex + 1} of ${image.referenceImageDataUrls.length}`}
          onPrev={image.referenceImageDataUrls.length > 1 ? () => setRefPreviewIndex((i) => i !== null ? (i - 1 + image.referenceImageDataUrls!.length) % image.referenceImageDataUrls!.length : null) : undefined}
          onNext={image.referenceImageDataUrls.length > 1 ? () => setRefPreviewIndex((i) => i !== null ? (i + 1) % image.referenceImageDataUrls!.length : null) : undefined}
        />
      )}
    </>
  );

  return (
    <ZoomModal
      src={imageSrc}
      alt={image.prompt ?? "Shared image"}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      zIndex={200}
      sidebar={infoPanel}
    />
  );
}

// ── Main SharedGallery ────────────────────────────────────────────────────────

export default function SharedGallery({
  images, pending, loading, session, workspaces = [], onDelete, onReference, onRestore, onPromptSelect, onCancel, onRetry, onBatchDelete, onBatchDownload, onBatchCopyTo, onBatchModeChange,
}: SharedGalleryProps) {
  const { state } = useApp();
  const [expandedImageId, setExpandedImageId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchMode, setBatchMode] = useState(false);
  const lastSelectedIdRef = useRef<string | null>(null);
  const allPhotosRef = useRef<GalleryPhoto[]>([]);

  const outerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(64);

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    setContainerWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!listRef.current) return;
    const rect = listRef.current.getBoundingClientRect();
    setScrollMargin(Math.round(rect.top + window.scrollY));
  }, [containerWidth]);

  const currentUserId = (session?.user as { id?: string } | undefined)?.id;
  const currentUserRole = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = currentUserRole === "admin";

  const isMobile = containerWidth > 0 && containerWidth < 640;
  const rowConfig = isMobile ? { targetRowHeight: 200, maxPhotos: 3 } : ROW_CONFIGS[state.rowHeightIndex];
  const effectiveTargetHeight = rowConfig.targetRowHeight;
  const effectiveMaxPhotos = rowConfig.maxPhotos;

  const allPhotos = useMemo<GalleryPhoto[]>(() => {
    const pendingPhotos: GalleryPhoto[] = pending.flatMap((p) =>
      Array.from({ length: p.count }, (_, i) => {
        const dims = getAspectDimensions(p.aspectRatio as AspectRatio);
        return {
          src: "", width: dims.width, height: dims.height,
          key: `pending-${p.id}-${i}`, alt: p.prompt,
          _image: null, isPending: true,
          pendingId: p.id, pendingPrompt: p.prompt,
          pendingStartedAt: p.startedAt,
          pendingFailed: p.failed, pendingErrorMessage: p.errorMessage,
        };
      })
    );
    const realPhotos: GalleryPhoto[] = images.map((img) => ({
      src: "", width: img.width, height: img.height,
      key: img.id, alt: img.prompt, _image: img, isPending: false,
    }));
    return [...pendingPhotos, ...realPhotos];
  }, [images, pending]);

  useEffect(() => {
    allPhotosRef.current = allPhotos;
  }, [allPhotos]);

  useEffect(() => {
    onBatchModeChange?.(batchMode);
  }, [batchMode, onBatchModeChange]);

  const realPhotos = useMemo(
    () => allPhotos.filter((p) => p._image !== null).map((p) => p._image as GeneratedImageMeta),
    [allPhotos]
  );

  const expandedIndex = useMemo(
    () => expandedImageId !== null ? realPhotos.findIndex((img) => img.id === expandedImageId) : -1,
    [expandedImageId, realPhotos]
  );
  const lightboxImage = expandedIndex >= 0 ? realPhotos[expandedIndex] : null;

  const rows = useMemo<GalleryRow[]>(() => {
    if (containerWidth <= 0 || allPhotos.length === 0) return [];
    const out: GalleryRow[] = [];
    let i = 0;
    let gi = 0;
    while (i < allPhotos.length) {
      let j = i + 1;
      let totalAR = allPhotos[i].width / allPhotos[i].height;
      while (j < allPhotos.length && j - i < effectiveMaxPhotos) {
        const ar = allPhotos[j].width / allPhotos[j].height;
        if ((totalAR + ar) * effectiveTargetHeight + (j - i) * SPACING > containerWidth) break;
        totalAR += ar;
        j++;
      }
      const photosInRow = allPhotos.slice(i, j);
      const isLastRow = j >= allPhotos.length;
      const totalSpacing = (photosInRow.length - 1) * SPACING;
      const totalAR2 = photosInRow.reduce((s, p) => s + p.width / p.height, 0);
      const stretched = (containerWidth - totalSpacing) / totalAR2;
      const rowHeight = isLastRow ? Math.min(stretched, effectiveTargetHeight) : stretched;
      out.push({
        photos: photosInRow.map((p, idx) => ({
          ...p,
          renderWidth: rowHeight * (p.width / p.height),
          renderHeight: rowHeight,
          globalIndex: gi + idx,
        })),
        height: rowHeight,
      });
      gi += photosInRow.length;
      i = j;
    }
    return out;
  }, [allPhotos, containerWidth, effectiveTargetHeight, effectiveMaxPhotos]);

  const estimateSize = useCallback(
    (i: number) => (rows[i]?.height ?? effectiveTargetHeight) + SPACING,
    [rows, effectiveTargetHeight]
  );

  const virtualizer = useWindowVirtualizer({ count: rows.length, estimateSize, overscan: 8, scrollMargin });

  useEffect(() => { virtualizer.measure(); }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrev = useCallback(() => {
    if (!realPhotos.length) return;
    setExpandedImageId((id) => {
      const idx = realPhotos.findIndex((img) => img.id === id);
      return realPhotos[(idx - 1 + realPhotos.length) % realPhotos.length].id;
    });
  }, [realPhotos]);

  const handleNext = useCallback(() => {
    if (!realPhotos.length) return;
    setExpandedImageId((id) => {
      const idx = realPhotos.findIndex((img) => img.id === id);
      return realPhotos[(idx + 1) % realPhotos.length].id;
    });
  }, [realPhotos]);

  const handleLightboxDelete = useCallback((id: string) => {
    onDelete?.(id);
    setExpandedImageId(null);
  }, [onDelete]);

  const exitBatchMode = useCallback(() => {
    setBatchMode(false);
    setSelectedIds(new Set());
    lastSelectedIdRef.current = null;
  }, []);

  const handleSelect = useCallback((id: string, selected: boolean, shift?: boolean) => {
    if (shift && selected && lastSelectedIdRef.current) {
      const realIds = allPhotosRef.current.filter((p) => !p.isPending).map((p) => p.key);
      const fromIdx = realIds.indexOf(lastSelectedIdRef.current);
      const toIdx = realIds.indexOf(id);
      if (fromIdx !== -1 && toIdx !== -1) {
        const [start, end] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        const rangeIds = realIds.slice(start, end + 1);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const rid of rangeIds) next.add(rid);
          setBatchMode(next.size > 0);
          return next;
        });
        lastSelectedIdRef.current = id;
        return;
      }
    }
    lastSelectedIdRef.current = selected ? id : null;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      setBatchMode(next.size > 0);
      return next;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && expandedImageId === null && batchMode) exitBatchMode();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [expandedImageId, batchMode, exitBatchMode]);

  const handleBatchDelete = useCallback(() => {
    const ids = Array.from(selectedIds);
    exitBatchMode();
    onBatchDelete?.(ids);
  }, [selectedIds, exitBatchMode, onBatchDelete]);

  const handleBatchDownload = useCallback(() => {
    onBatchDownload?.(Array.from(selectedIds));
  }, [selectedIds, onBatchDownload]);

  const handleBatchCopyTo = useCallback((targetWorkspaceId: string) => {
    onBatchCopyTo?.(Array.from(selectedIds), targetWorkspaceId);
  }, [selectedIds, onBatchCopyTo]);

  const handleSelectAll = useCallback(() => {
    const allRealIds = new Set(allPhotosRef.current.filter((p) => !p.isPending).map((p) => p.key));
    setSelectedIds(allRealIds);
    setBatchMode(true);
  }, []);

  return (
    <>
      <div className="min-h-screen pt-14 sm:pt-16 pb-52" ref={outerRef}>
        {allPhotos.length > 0 && containerWidth > 0 && (
          <div ref={listRef} style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const row = rows[vRow.index];
              if (!row) return null;
              return (
                <div
                  key={vRow.key}
                  style={{
                    position: "absolute", top: 0, left: 0, width: "100%",
                    height: `${row.height}px`,
                    transform: `translateY(${vRow.start - scrollMargin}px)`,
                    display: "flex", gap: `${SPACING}px`,
                  }}
                >
                  {row.photos.map((photo) => (
                    <div
                      key={photo.key}
                      style={{ width: photo.renderWidth, height: photo.renderHeight, position: "relative", flexShrink: 0, overflow: "hidden" }}
                    >
                      {photo.isPending ? (
                        <ShimmerPlaceholder
                          prompt={photo.pendingPrompt ?? ""}
                          startedAt={photo.pendingStartedAt}
                          failed={photo.pendingFailed}
                          errorMessage={photo.pendingErrorMessage}
                          onCancel={photo.pendingId ? () => onCancel?.(photo.pendingId!) : undefined}
                          onRetry={photo.pendingId && photo.pendingFailed ? () => onRetry?.(photo.pendingId!) : undefined}
                        />
                      ) : (
                        <SharedCard
                          image={photo._image!}
                          index={photo.globalIndex}
                          isOwn={photo._image!.userId === currentUserId}
                          isAdmin={isAdmin}
                          workspaces={workspaces}
                          onExpand={() => setExpandedImageId(photo._image!.id)}
                          onDelete={onDelete}
                          onReference={onReference}
                          onRestore={onRestore}
                          onPromptSelect={onPromptSelect}
                          isSelected={selectedIds.has(photo._image!.id)}
                          onSelect={handleSelect}
                          batchMode={batchMode}
                        />
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {allPhotos.length === 0 && (
          loading ? (
            <div className="flex items-center justify-center min-h-[60vh]">
              <svg className="animate-spin text-text-secondary/30" width="24" height="24" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 px-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/5">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400/40">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </div>
              <div className="text-center space-y-1.5">
                <p className="text-sm font-medium text-text-secondary/70">Nothing here yet</p>
                <p className="text-xs text-text-secondary/40 max-w-[240px] leading-relaxed">
                  Generate something below to be the first to share with everyone.
                </p>
              </div>
            </div>
          )
        )}
      </div>

      <AnimatePresence>
        {!isMobile && batchMode && (
          <BatchSelectBar
            count={selectedIds.size}
            totalCount={allPhotos.filter((p) => !p.isPending).length}
            onSelectAll={handleSelectAll}
            onDownload={handleBatchDownload}
            onDelete={handleBatchDelete}
            workspaces={workspaces}
            currentWorkspaceId=""
            onCopyTo={handleBatchCopyTo}
            onMoveTo={() => {}}
            showMoveTo={false}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {lightboxImage && (
          <SharedLightbox
            image={lightboxImage}
            isOwn={lightboxImage.userId === currentUserId}
            isAdmin={isAdmin}
            onClose={() => setExpandedImageId(null)}
            onPrev={handlePrev}
            onNext={handleNext}
            onDelete={handleLightboxDelete}
            onReference={onReference}
            onRestore={onRestore}
            onPromptSelect={onPromptSelect}
          />
        )}
      </AnimatePresence>
    </>
  );
}
