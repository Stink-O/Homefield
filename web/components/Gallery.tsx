"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef, memo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Download, Wand2, SlidersHorizontal, Info, ChevronDown, ChevronUp, Copy, Check, Trash2, ImagePlus } from "lucide-react";
import { useApp } from "@/contexts/AppContext";
import ImageCard from "./ImageCard";
import ShimmerPlaceholder from "./ShimmerPlaceholder";
import ZoomModal from "./ZoomModal";
import BatchSelectBar from "./BatchSelectBar";
import { ROW_CONFIGS, MODELS, getAspectDimensions, type AspectRatio, type GeneratedImageMeta } from "@/lib/types";
import { copyText } from "@/lib/uuid";
import { deleteFromHistory } from "@/lib/storage";

interface PendingGeneration {
  id: string;
  prompt: string;
  aspectRatio: string;
  count: number;
  workspaceId: string;
  startedAt: number;
  failed?: boolean;
  errorMessage?: string;
  generating?: boolean;
}

interface GalleryProps {
  pending: PendingGeneration[];
  onPromptSelect?: (prompt: string) => void;
  onRestore?: (image: GeneratedImageMeta) => void;
  onReference?: (image: GeneratedImageMeta) => void;
  onBatchDelete?: (ids: string[]) => void;
  onBatchDownload?: (ids: string[]) => void;
  onBatchModeChange?: (active: boolean) => void;
  onBatchCopyTo?: (ids: string[], targetWorkspaceId: string) => void;
  onBatchMoveTo?: (ids: string[], targetWorkspaceId: string) => void;
  onCancel?: (pendingId: string) => void;
  onRetry?: (pendingId: string) => void;
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
  pendingGenerating?: boolean;
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

function computeRowLayout(
  photos: GalleryPhoto[],
  containerWidth: number,
  targetRowHeight: number,
  maxPhotos: number,
): GalleryRow[] {
  if (containerWidth <= 0 || photos.length === 0) return [];

  const rows: GalleryRow[] = [];
  let i = 0;
  let globalIndex = 0;

  while (i < photos.length) {
    // Start with one photo, then greedily add more until the row would overflow
    let j = i + 1;
    let totalAR = photos[i].width / photos[i].height;

    while (j < photos.length && j - i < maxPhotos) {
      const ar = photos[j].width / photos[j].height;
      // Projected row width if we add this photo at targetRowHeight
      const projectedWidth = (totalAR + ar) * targetRowHeight + (j - i) * SPACING;
      if (projectedWidth > containerWidth) break;
      totalAR += ar;
      j++;
    }

    const photosInRow = photos.slice(i, j);
    const isLastRow = j >= photos.length;
    const totalSpacing = (photosInRow.length - 1) * SPACING;
    const totalAspectRatio = photosInRow.reduce((sum, p) => sum + p.width / p.height, 0);
    const stretchedHeight = (containerWidth - totalSpacing) / totalAspectRatio;
    // Last row: don't stretch beyond targetRowHeight — looks bad when there are few images
    const rowHeight = isLastRow ? Math.min(stretchedHeight, targetRowHeight) : stretchedHeight;

    rows.push({
      photos: photosInRow.map((p, idx) => ({
        ...p,
        renderWidth: rowHeight * (p.width / p.height),
        renderHeight: rowHeight,
        globalIndex: globalIndex + idx,
      })),
      height: rowHeight,
    });

    globalIndex += photosInRow.length;
    i = j;
  }

  return rows;
}

// Shared lightbox rendered at the Gallery level
function GalleryLightbox({
  image,
  onClose,
  onPrev,
  onNext,
  onRestore,
  onReference,
  onPromptSelect,
  onDelete,
}: {
  image: GeneratedImageMeta;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRestore?: (image: GeneratedImageMeta) => void;
  onReference?: (image: GeneratedImageMeta) => void;
  onPromptSelect?: (prompt: string) => void;
  onDelete?: (id: string) => void;
}) {
  const [copiedPanel, setCopiedPanel] = useState(false);
  const [seeAll, setSeeAll] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [refPreviewIndex, setRefPreviewIndex] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Reset all local state when navigating to a different image
  useEffect(() => {
    setSeeAll(false);
    setPromptExpanded(false);
    setCopiedPanel(false);
    setDeleteConfirm(false);
    setRefPreviewIndex(null);
  }, [image.id]);

  // Always use the download endpoint for full-resolution lightbox display.
  // Avoids fragile URL string manipulation and guarantees the correct file path
  // from the DB regardless of caching state or how the image was added to state.
  const imageSrc = `/api/images/${image.id}/download`;
  const modelLabel = MODELS.find((m) => m.id === image.model)?.label ?? image.model;
  const formattedDate = new Date(image.timestamp).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
  const isLongPrompt = image.prompt.length > PROMPT_TRUNCATE_LENGTH;
  const displayedPrompt = isLongPrompt && !promptExpanded
    ? image.prompt.slice(0, PROMPT_TRUNCATE_LENGTH)
    : image.prompt;

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const res = await fetch(`/api/images/${image.id}/download`);
    if (!res.ok) return;
    const blob = await res.blob();
    const slug = image.prompt.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "_");
    const ext = image.mimeType === "image/jpeg" ? "jpg" : "png";
    const fileName = `homefield_${slug}.${ext}`;

    // Web Share API — mobile only (touch device)
    const isMobile = navigator.maxTouchPoints > 0 && window.innerWidth < 768;
    if (isMobile && typeof navigator.canShare === "function") {
      try {
        const file = new File([blob], fileName, { type: image.mimeType });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] });
          return;
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        // fall through
      }
    }

    // Desktop fallback
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = fileName;
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

  const handleRestorePanel = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRestore?.(image);
    onClose();
  };

  const handleReferencePanel = (e: React.MouseEvent) => {
    e.stopPropagation();
    onReference?.(image);
    onClose();
  };

  const handleDeleteMobile = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    onDelete?.(image.id);
    onClose();
  };

  const infoPanel = (
    <>
      {/* ── Mobile action bar (hidden on sm+) ── */}
      <div
        className="sm:hidden bg-surface px-6 py-5 rounded-t-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Row 1: primary actions */}
        <div className="flex justify-around mb-5">
          {onRestore && (
            <button onClick={handleRestorePanel} className="flex flex-col items-center gap-2">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent">
                <Wand2 size={22} className="text-black" />
              </div>
              <span className="text-xs text-text-secondary/80 font-medium">Restore</span>
            </button>
          )}
          {onReference && (
            <button onClick={handleReferencePanel} className="flex flex-col items-center gap-2">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--border)]">
                <ImagePlus size={22} className="text-text-primary" />
              </div>
              <span className="text-xs text-text-secondary/80 font-medium">Reference</span>
            </button>
          )}
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
          <button onClick={handleDeleteMobile} className="flex flex-col items-center gap-2">
            <div className={`flex h-14 w-14 items-center justify-center rounded-2xl transition-colors ${deleteConfirm ? "bg-red-500" : "bg-[var(--border)]"}`}>
              <Trash2 size={22} className={deleteConfirm ? "text-white" : "text-red-400"} />
            </div>
            <span className="text-xs text-text-secondary/80 font-medium">{deleteConfirm ? "Confirm?" : "Delete"}</span>
          </button>
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
            {/* Prompt */}
            <div className="bg-[var(--border)] rounded-xl p-3 mb-4">
              <p className="text-xs text-text-primary leading-relaxed">
                {displayedPrompt}
                {isLongPrompt && !promptExpanded && (
                  <>
                    {"... "}
                    <button onClick={() => setPromptExpanded(true)} className="text-text-secondary/50 hover:text-text-secondary transition-colors underline underline-offset-2">
                      Show more
                    </button>
                  </>
                )}
                {isLongPrompt && promptExpanded && (
                  <>
                    {" "}
                    <button onClick={() => setPromptExpanded(false)} className="text-text-secondary/50 hover:text-text-secondary transition-colors underline underline-offset-2">
                      Show less
                    </button>
                  </>
                )}
              </p>
            </div>
            {/* Info rows */}
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
              <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                <span className="text-xs text-text-secondary">Aspect Ratio</span>
                <span className="text-xs text-text-primary font-semibold text-right">{image.aspectRatio}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
                <span className="text-xs text-text-secondary">Created</span>
                <span className="text-xs text-text-primary font-semibold text-right">{formattedDate}</span>
              </div>
              {image.referenceImageDataUrls && image.referenceImageDataUrls.length > 0 && (
                <div className="flex justify-between items-start py-2">
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
            </div>
          </div>
        </div>
      </div>

      {/* ── Desktop info panel (hidden on mobile) ── */}
      <div
        className="hidden sm:flex w-72 h-full flex-shrink-0 flex-col overflow-y-auto bg-surface border-l border-[var(--border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 space-y-5 flex flex-col flex-1">

          <div>
            <div className="flex items-center">
              <SlidersHorizontal size={11} className="text-text-secondary/50" />
              <span className="text-[10px] uppercase tracking-wide text-text-secondary/60 font-medium flex-1 ml-1.5">PROMPT</span>
              <button
                onClick={handleCopyPanel}
                className="rounded-md border border-[var(--border)] bg-[var(--border)] px-2 py-0.5 text-[10px] text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1"
              >
                {copiedPanel ? <Check size={10} /> : <Copy size={10} />}
                {copiedPanel ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="bg-[var(--border)] rounded-xl p-3 mt-2">
              <p className="text-xs text-text-primary leading-relaxed">
                {displayedPrompt}
                {isLongPrompt && !promptExpanded && (
                  <>
                    {"... "}
                    <button
                      onClick={() => setPromptExpanded(true)}
                      className="text-text-secondary/50 hover:text-text-secondary transition-colors underline underline-offset-2"
                    >
                      Show more
                    </button>
                  </>
                )}
                {isLongPrompt && promptExpanded && (
                  <>
                    {" "}
                    <button
                      onClick={() => setPromptExpanded(false)}
                      className="text-text-secondary/50 hover:text-text-secondary transition-colors underline underline-offset-2"
                    >
                      Show less
                    </button>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="border-t border-[var(--border)]" />

          <div>
            <div className="flex items-center">
              <Info size={11} className="text-text-secondary/50" />
              <span className="text-[10px] uppercase tracking-wide text-text-secondary/60 font-medium ml-1.5">INFORMATION</span>
            </div>
            <div className="mt-2">
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

              <div
                className="flex justify-between items-center py-2 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => setSeeAll((prev) => !prev)}
              >
                <span className="text-xs text-text-secondary">See all</span>
                <ChevronDown
                  size={13}
                  className="text-text-secondary transition-transform"
                  style={{ transform: seeAll ? "rotate(180deg)" : "rotate(0deg)" }}
                />
              </div>
            </div>
          </div>

          <div className="mt-auto pt-4 border-t border-[var(--border)] flex flex-col gap-2">
            <button
              onClick={handleDownload}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--border)] py-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              <Download size={13} />
              Download
            </button>
            {onRestore && (
              <button
                onClick={handleRestorePanel}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent/15 border border-accent/25 py-2 text-xs font-medium text-accent hover:bg-accent/25 transition-colors"
              >
                <Wand2 size={13} />
                Restore to prompt
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
      alt={image.prompt ?? "Generated image"}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      zIndex={200}
      sidebar={infoPanel}
      imageId={image.id}
    />
  );
}

export default memo(function Gallery({ pending, onPromptSelect, onRestore, onReference, onBatchDelete, onBatchDownload, onBatchModeChange, onBatchCopyTo, onBatchMoveTo, onCancel, onRetry }: GalleryProps) {
  const { state, dispatch, loadMoreHistory } = useApp();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchMode, setBatchMode] = useState(false);
  const [expandedImageId, setExpandedImageId] = useState<string | null>(null);
  const lastSelectedIdRef = useRef<string | null>(null);
  const allPhotosRef = useRef<GalleryPhoto[]>([]);
  const loadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Container width measurement
  const outerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(64); // default to header height

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    // Read width synchronously before first paint so the gallery doesn't flash blank
    setContainerWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Measure the virtual list's distance from the top of the page for the virtualizer
  useLayoutEffect(() => {
    if (!listRef.current) return;
    const rect = listRef.current.getBoundingClientRect();
    setScrollMargin(Math.round(rect.top + window.scrollY));
  }, [containerWidth]); // re-measure when width first becomes available

  useEffect(() => {
    onBatchModeChange?.(batchMode);
  }, [batchMode, onBatchModeChange]);

  useEffect(() => {
    exitBatchMode();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentWorkspaceId]);

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
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      setBatchMode(next.size > 0);
      return next;
    });
  }, []);

  const exitBatchMode = useCallback(() => {
    setBatchMode(false);
    setSelectedIds(new Set());
    lastSelectedIdRef.current = null;
  }, []);

  const allPhotos = useMemo<GalleryPhoto[]>(() => {
    const realPhotos: GalleryPhoto[] = state.history.map((img) => ({
      src: "",
      width: img.width,
      height: img.height,
      key: img.id,
      alt: img.prompt,
      _image: img,
      isPending: false,
    }));

    const pendingPhotos: GalleryPhoto[] = pending
      .filter((p) => (p.workspaceId ?? "main") === state.currentWorkspaceId)
      .flatMap((p) =>
        Array.from({ length: p.count }, (_, i) => {
          const dims = getAspectDimensions(p.aspectRatio as AspectRatio);
          return {
            src: "",
            width: dims.width,
            height: dims.height,
            key: `pending-${p.id}-${i}`,
            alt: p.prompt,
            _image: null,
            isPending: true,
            pendingId: p.id,
            pendingPrompt: p.prompt,
            pendingStartedAt: p.startedAt,
            pendingFailed: p.failed,
            pendingErrorMessage: p.errorMessage,
            pendingGenerating: p.generating,
          };
        })
      );

    return [...pendingPhotos, ...realPhotos];
  }, [state.history, state.currentWorkspaceId, pending]);

  useEffect(() => {
    allPhotosRef.current = allPhotos;
  }, [allPhotos]);

  // Real images only, in allPhotos order (pending first, then history), for arrow navigation
  const realPhotos = useMemo(
    () => allPhotos.filter((p) => p._image !== null).map((p) => p._image as GeneratedImageMeta),
    [allPhotos]
  );

  const expandedIndex = useMemo(
    () => expandedImageId !== null ? realPhotos.findIndex((img) => img.id === expandedImageId) : -1,
    [expandedImageId, realPhotos]
  );

  // expandedImage is now GeneratedImageMeta | null (used only for navigation logic)
  const expandedImage = expandedIndex >= 0 ? realPhotos[expandedIndex] : null;

  // Full image meta for the lightbox (no base64 needed — served on demand from server)
  const [lightboxImage, setLightboxImage] = useState<GeneratedImageMeta | null>(null);
  const [lightboxLoading, setLightboxLoading] = useState(false);

  useEffect(() => {
    if (!expandedImageId) {
      setLightboxImage(null);
      return;
    }
    // Find in already-loaded history state (meta only, no base64)
    const meta = realPhotos.find((img) => img.id === expandedImageId) ?? null;
    setLightboxImage(meta);
    setLightboxLoading(false);
  }, [expandedImageId, realPhotos]);

  // Suppress unused warning — lightboxLoading could be used for a spinner in the future
  void lightboxLoading;

  const handlePrev = useCallback(() => {
    if (realPhotos.length === 0) return;
    setExpandedImageId((id) => {
      const idx = realPhotos.findIndex((img) => img.id === id);
      const prevIdx = (idx - 1 + realPhotos.length) % realPhotos.length;
      return realPhotos[prevIdx].id;
    });
  }, [realPhotos]);

  const handleNext = useCallback(() => {
    if (realPhotos.length === 0) return;
    setExpandedImageId((id) => {
      const idx = realPhotos.findIndex((img) => img.id === id);
      const nextIdx = (idx + 1) % realPhotos.length;
      return realPhotos[nextIdx].id;
    });
  }, [realPhotos]);

  const handleLightboxDelete = useCallback(async (imageId: string) => {
    const res = await fetch(`/api/images/${imageId}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      console.error(`[HomeField] Failed to delete image ${imageId}: ${res?.status ?? "network error"}`);
      return;
    }
    dispatch({ type: "DELETE_IMAGE", payload: imageId });
    deleteFromHistory(imageId).catch(() => {});
    setExpandedImageId(null);
  }, [dispatch]);

  // Stable callbacks and derived values passed to ImageCard as props.
  // This removes the need for ImageCard to call useApp() directly — keeping it
  // a pure props-in/render-out component so memo() actually prevents re-renders.
  const handleExpand = useCallback((id: string) => {
    setExpandedImageId(id);
  }, []);

  const handleDeleteImage = useCallback((id: string) => {
    fetch(`/api/images/${id}`, { method: "DELETE" })
      .then((res) => { if (!res.ok) console.error(`[HomeField] Failed to delete image ${id}: ${res.status}`); })
      .catch(() => console.error(`[HomeField] Network error deleting image ${id}`));
    dispatch({ type: "DELETE_IMAGE", payload: id });
    deleteFromHistory(id).catch(() => {});
  }, [dispatch]);

  const handleRemoveFromView = useCallback((id: string) => {
    dispatch({ type: "REMOVE_FROM_VIEW", payload: id });
  }, [dispatch]);

  const otherWorkspaces = useMemo(
    () => state.workspaces.filter((ws) => ws.id !== state.currentWorkspaceId),
    [state.workspaces, state.currentWorkspaceId],
  );

  // Keyboard: batch mode escape only — ZoomModal handles Escape + Arrow navigation for the lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && expandedImageId === null && batchMode) {
        exitBatchMode();
      }
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
    const ids = Array.from(selectedIds);
    onBatchCopyTo?.(ids, targetWorkspaceId);
  }, [selectedIds, onBatchCopyTo]);

  const handleBatchMoveTo = useCallback((targetWorkspaceId: string) => {
    const ids = Array.from(selectedIds);
    exitBatchMode();
    onBatchMoveTo?.(ids, targetWorkspaceId);
  }, [selectedIds, exitBatchMode, onBatchMoveTo]);

  const handleSelectAll = useCallback(() => {
    const allRealIds = new Set(allPhotosRef.current.filter((p) => !p.isPending).map((p) => p.key));
    setSelectedIds(allRealIds);
    setBatchMode(true);
  }, []);

  const isMobile = containerWidth > 0 && containerWidth < 640;
  const config = isMobile
    ? { targetRowHeight: 200, maxPhotos: 5 }
    : ROW_CONFIGS[state.rowHeightIndex];

  const rows = useMemo(
    () => computeRowLayout(allPhotos, containerWidth, config.targetRowHeight, config.maxPhotos),
    [allPhotos, containerWidth, config.targetRowHeight, config.maxPhotos]
  );

  // Keep a stable ref to the latest rows so estimateSize doesn't change on every layout update.
  // The virtualizer re-initializes whenever estimateSize gets a new reference, which previously
  // happened on every image add/remove. Using a ref gives it accurate heights without instability.
  const rowsRef = useRef(rows);
  useLayoutEffect(() => { rowsRef.current = rows; }, [rows]);

  const estimateSize = useCallback(
    (i: number) => (rowsRef.current[i]?.height ?? config.targetRowHeight) + SPACING,
    [config.targetRowHeight] // stable — rows accessed via ref, not as a dep
  );

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize,
    overscan: 8,
    scrollMargin,
  });

  // Re-measure whenever rows change (count, heights, or container width).
  // Using `rows` (a memoized reference) rather than `rows.length` ensures the virtualizer
  // re-reads estimateSize when row heights shift — e.g. when a pending slot at one aspect
  // ratio is replaced by a real image at a different aspect ratio, or when row packing
  // changes. Without this the virtualizer uses stale heights, causing items to overlap or
  // leave gaps. `rows` is stable across renders (only changes when actual data changes)
  // so this does not fire during shimmer animation frames.
  useEffect(() => {
    virtualizer.measure();
  }, [rows, containerWidth]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load more images when the user scrolls near the bottom.
  // Previously used virtualizer.getVirtualItems() as a dep, which returns a new array on every
  // call — causing this effect to re-run on every render. Using the last visible item's index
  // (a stable number) means the effect only runs when the visible range actually changes.
  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtualItemIndex = virtualItems.at(-1)?.index;

  useEffect(() => {
    if (!state.historyHasMore) return;
    if (lastVirtualItemIndex === undefined) return;
    if (lastVirtualItemIndex >= rows.length - 5) {
      if (loadMoreTimerRef.current) clearTimeout(loadMoreTimerRef.current);
      loadMoreTimerRef.current = setTimeout(() => {
        loadMoreHistory();
      }, 300);
    }
    return () => {
      if (loadMoreTimerRef.current) clearTimeout(loadMoreTimerRef.current);
    };
  }, [lastVirtualItemIndex, rows.length, state.historyHasMore, loadMoreHistory]);

  return (
    <>
      <div className="min-h-screen pt-14 sm:pt-16 pb-52" ref={outerRef}>
        {allPhotos.length > 0 && containerWidth > 0 && (
          <div
            ref={listRef}
            style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}
          >
            {virtualItems.map((vRow) => {
              const row = rows[vRow.index];
              if (!row) return null;
              return (
                <div
                  key={vRow.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${row.height}px`,
                    transform: `translateY(${vRow.start - scrollMargin}px)`,
                    display: "flex",
                    gap: `${SPACING}px`,
                  }}
                >
                  {row.photos.map((photo) => (
                    <div
                      key={photo.key}
                      style={{
                        width: photo.renderWidth,
                        height: photo.renderHeight,
                        position: "relative",
                        flexShrink: 0,
                        overflow: "hidden",
                      }}
                    >
                      {photo.isPending ? (
                        <ShimmerPlaceholder
                          prompt={photo.pendingPrompt ?? ""}
                          startedAt={photo.pendingStartedAt!}
                          failed={photo.pendingFailed}
                          errorMessage={photo.pendingErrorMessage}
                          generating={photo.pendingGenerating}
                          onCancel={photo.pendingId ? () => onCancel?.(photo.pendingId!) : undefined}
                          onRetry={photo.pendingId && photo.pendingFailed ? () => onRetry?.(photo.pendingId!) : undefined}
                        />
                      ) : (
                        <ImageCard
                          image={photo._image!}
                          index={photo.globalIndex}
                          onPromptSelect={onPromptSelect}
                          onRestore={onRestore}
                          onReference={onReference}
                          isSelected={selectedIds.has(photo._image!.id)}
                          onSelect={handleSelect}
                          batchMode={batchMode}
                          onExpand={handleExpand}
                          otherWorkspaces={otherWorkspaces}
                          onRemoveFromView={handleRemoveFromView}
                          onDeleteImage={handleDeleteImage}
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
          state.historyLoading ? (
            <div className="flex items-center justify-center min-h-[60vh]">
              <svg
                className="animate-spin text-text-secondary/30"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 px-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--chrome-surface)]">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-text-secondary/40"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </div>
              <div className="text-center space-y-1.5">
                <p className="text-sm font-medium text-text-secondary/70">No images yet</p>
                <p className="text-xs text-text-secondary/40 max-w-[220px] leading-relaxed">
                  Enter a prompt below and hit Generate to create your first image.
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
            workspaces={state.workspaces}
            currentWorkspaceId={state.currentWorkspaceId}
            onCopyTo={handleBatchCopyTo}
            onMoveTo={handleBatchMoveTo}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showScrollTop && (
          <motion.div
            key="scroll-top"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            whileHover={{ scale: 1.05 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed top-[70px] left-1/2 -translate-x-1/2 z-[150] p-[2px] rounded-2xl overflow-hidden"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
              style={{
                position: "absolute",
                width: "200%",
                height: "200%",
                top: "-50%",
                left: "-50%",
                background: "conic-gradient(from 0deg, transparent 0%, transparent 50%, rgba(163,230,53,0.4) 65%, rgba(163,230,53,1) 75%, rgba(163,230,53,0.4) 85%, transparent 100%)",
              }}
            />
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="relative glass-command flex items-center justify-center rounded-[14px] w-10 h-10 text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
              aria-label="Scroll to top"
            >
              <ChevronUp size={17} strokeWidth={2.5} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {lightboxImage && (
          <GalleryLightbox
            image={lightboxImage}
            onClose={() => setExpandedImageId(null)}
            onPrev={handlePrev}
            onNext={handleNext}
            onRestore={onRestore}
            onReference={onReference}
            onPromptSelect={onPromptSelect}
            onDelete={handleLightboxDelete}
          />
        )}
      </AnimatePresence>
    </>
  );
});
