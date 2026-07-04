"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef, memo } from "react";
import { AnimatePresence } from "framer-motion";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useApp } from "@/contexts/AppContext";
import ImageCard from "./ImageCard";
import ShimmerPlaceholder from "./ShimmerPlaceholder";
import BatchSelectBar from "./BatchSelectBar";
import GalleryLightbox from "./gallery/GalleryLightbox";
import GalleryEmptyState from "./gallery/GalleryEmptyState";
import ScrollTopButton from "./gallery/ScrollTopButton";
import { SPACING, computeRowLayout, type GalleryPhoto } from "./gallery/rowLayout";
import { ROW_CONFIGS, getAspectDimensions, type AspectRatio, type GeneratedImageMeta } from "@/lib/types";
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



export default memo(function Gallery({ pending, onPromptSelect, onRestore, onReference, onBatchDelete, onBatchDownload, onBatchModeChange, onBatchCopyTo, onBatchMoveTo, onCancel, onRetry }: GalleryProps) {
  const { state, dispatch, loadMoreHistory } = useApp();
  // When the media-key bar is docked under the header, push gallery content down
  // by its height so it isn't overlapped. Kept in sync with MediaKeyBanner.
  const keyBarShown = state.mediaKeyConfigured === false;
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
  }, [containerWidth, keyBarShown]); // re-measure on width and when the key bar toggles

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
      <div className={`min-h-screen pb-52 ${keyBarShown ? "pt-[6.5rem] sm:pt-28" : "pt-14 sm:pt-16"}`} ref={outerRef}>
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

        {allPhotos.length === 0 && <GalleryEmptyState loading={state.historyLoading} />}
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

      <ScrollTopButton show={showScrollTop} />

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
