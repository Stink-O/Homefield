"use client";

import { useCallback, useLayoutEffect, useMemo, useState, useEffect, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { Session } from "next-auth";
import ShimmerPlaceholder from "./ShimmerPlaceholder";
import BatchSelectBar from "./BatchSelectBar";
import SharedCard from "./shared-gallery/SharedCard";
import SharedLightbox from "./shared-gallery/SharedLightbox";
import ScrollTopButton from "./gallery/ScrollTopButton";
import { SPACING, computeRowLayout, type GalleryPhoto } from "./gallery/rowLayout";
import { ROW_CONFIGS, getAspectDimensions, type AspectRatio, type GeneratedImageMeta, type Workspace } from "@/lib/types";
import { useApp } from "@/contexts/AppContext";

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



// ── Main SharedGallery ────────────────────────────────────────────────────────

export default function SharedGallery({
  images, pending, loading, session, workspaces = [], onDelete, onReference, onRestore, onPromptSelect, onCancel, onRetry, onBatchDelete, onBatchDownload, onBatchCopyTo, onBatchModeChange,
}: SharedGalleryProps) {
  const { state } = useApp();
  const [expandedImageId, setExpandedImageId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchMode, setBatchMode] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const lastSelectedIdRef = useRef<string | null>(null);
  const allPhotosRef = useRef<GalleryPhoto[]>([]);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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

  const rows = useMemo(
    () => computeRowLayout(allPhotos, containerWidth, effectiveTargetHeight, effectiveMaxPhotos),
    [allPhotos, containerWidth, effectiveTargetHeight, effectiveMaxPhotos]
  );

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

      <ScrollTopButton show={showScrollTop} />

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
