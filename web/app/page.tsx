"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useApp } from "@/contexts/AppContext";
import Header from "@/components/Header";
import CommandBar from "@/components/CommandBar";
import MobilePromptSheet from "@/components/MobilePromptSheet";
import Gallery from "@/components/Gallery";
import SettingsModal from "@/components/SettingsModal";
import CredentialModal from "@/components/CredentialModal";
import MediaKeyBanner from "@/components/MediaKeyBanner";
import TemplateDrawer from "@/components/TemplateDrawer";
import BeamOverlay from "@/components/BeamOverlay";
import ErrorToasts, { useErrorToasts } from "@/components/ErrorToasts";
import { generateImage } from "@/lib/gemini";
import type { RemotePendingItem } from "@/contexts/AppContext";
import {
  type GeneratedImageMeta,
  type AttachedImage,
  type AspectRatio,
  type ModelId,
  type Quality,
  normalizeModelId,
} from "@/lib/types";
import { randomUUID } from "@/lib/uuid";
import { removePendingJob, addFailedJob, removeFailedJob, getFailedJobs, trimImagesForStorage } from "@/lib/pendingJobs";
import { getRefImageDimensions, closestAspectRatio } from "@/lib/aspect";
import { useOrphanRecovery, type PendingGeneration } from "@/lib/hooks/useOrphanRecovery";
import { useBatchImageActions } from "@/lib/hooks/useBatchImageActions";

interface AttachedImageWithThumb extends AttachedImage {
  thumbnail: string;
}

export default function Home() {
  const { state, dispatch } = useApp();
  const [pending, setPending] = useState<PendingGeneration[]>([]);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const promptSetterRef = useRef<((p: string) => void) | null>(null);
  const restoreRef = useRef<((prompt: string, images: AttachedImageWithThumb[]) => void) | null>(null);
  const addImageRef = useRef<((url: string, mimeType?: string) => void) | null>(null);
  const mobilePromptSetterRef = useRef<((p: string) => void) | null>(null);
  const mobileRestoreRef = useRef<((prompt: string, images: AttachedImageWithThumb[]) => void) | null>(null);
  const mobileAddImageRef = useRef<((url: string, mimeType?: string) => void) | null>(null);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const failedJobsRestoredRef = useRef(false);
  const pendingRef = useRef<PendingGeneration[]>([]);
  const remotePendingRef = useRef<RemotePendingItem[]>([]);
  const textareaRectRef = useRef<(() => DOMRect | null) | null>(null);
  const [beamProps, setBeamProps] = useState<{ from: { x: number; y: number }; to: { x: number; y: number }; toSize: { width: number; height: number } } | null>(null);
  const { errorToasts, pushErrorToast, dismissErrorToast } = useErrorToasts();

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    remotePendingRef.current = state.remotePending;
  }, [state.remotePending]);

  // Restore failed cards from the previous session, but only after the history gallery
  // has finished loading. This prevents a flash where error cards appear alone for a
  // frame or two before the real history images populate.
  useEffect(() => {
    if (state.historyLoading) return;
    if (failedJobsRestoredRef.current) return;
    failedJobsRestoredRef.current = true;

    // "shared" workspace is a sentinel for the shared space page — exclude it here.
    const failedJobs = getFailedJobs()
      .filter((j) => j.workspaceId !== "shared")
      .filter((j) => !pendingRef.current.some((p) => p.id === j.id));
    if (!failedJobs.length) return;

    setPending((prev) => [
      ...failedJobs.map((job) => ({
        id: job.id,
        prompt: job.prompt,
        aspectRatio: job.aspectRatio,
        selectedAspectRatio: job.selectedAspectRatio,
        count: 1,
        workspaceId: job.workspaceId,
        startedAt: job.failedAt,
        model: job.model,
        quality: job.quality,
        searchGrounding: job.searchGrounding,
        images: job.images,
        failed: true as const,
        errorMessage: job.errorMessage,
      })),
      ...prev,
    ]);
  }, [state.historyLoading]);

  useOrphanRecovery(setPending, abortControllersRef, pushErrorToast);

  const { handleBatchDelete, handleBatchCopyTo, handleBatchMoveTo, handleBatchDownload } = useBatchImageActions();

  const handlePromptSelect = useCallback((p: string) => {
    promptSetterRef.current?.(p);
    if (window.innerWidth < 640) mobilePromptSetterRef.current?.(p);
  }, []);

  const handleRestore = useCallback(async (image: GeneratedImageMeta) => {
    dispatch({ type: "SET_MODEL", payload: normalizeModelId(image.model) });
    dispatch({ type: "SET_ASPECT_RATIO", payload: image.selectedAspectRatio ?? image.aspectRatio });
    if (image.quality) dispatch({ type: "SET_QUALITY", payload: image.quality });
    dispatch({ type: "SET_SEARCH_GROUNDING", payload: image.searchGrounding ?? false });
    promptSetterRef.current?.(image.prompt);

    const refImages: AttachedImageWithThumb[] = [];
    if (image.referenceImageDataUrls && image.referenceImageDataUrls.length > 0) {
      const totalRefCount = image.referenceImageDataUrls.length;
      for (const url of image.referenceImageDataUrls) {
        const res = await fetch(url).catch(() => null);
        if (!res?.ok) continue;
        const buffer = await res.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const chunks: string[] = [];
        for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
        const b64 = btoa(chunks.join(""));
        const mimeType = res.headers.get("content-type") || "image/png";
        refImages.push({ base64: b64, mimeType, thumbnail: url });
      }
      const skipped = totalRefCount - refImages.length;
      if (skipped > 0) {
        pushErrorToast(`${skipped} of ${totalRefCount} reference image${totalRefCount !== 1 ? "s" : ""} could not be loaded and ${skipped !== 1 ? "were" : "was"} skipped.`);
      }
    }

    restoreRef.current?.(image.prompt, refImages);
    if (window.innerWidth < 640) mobileRestoreRef.current?.(image.prompt, refImages);
  }, [dispatch, pushErrorToast]);

  const handleReference = useCallback(async (image: GeneratedImageMeta) => {
    const res = await fetch(`/api/images/${image.id}/download`);
    if (!res.ok) return;
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    addImageRef.current?.(blobUrl, image.mimeType);
    if (window.innerWidth < 640) mobileAddImageRef.current?.(blobUrl, image.mimeType);
  }, []);

  // Generates exactly one image. Call multiple times for batch.
  const runGeneration = useCallback(async (params: {
    prompt: string;
    model: ModelId;
    aspectRatio: AspectRatio;
    quality: Quality;
    workspaceId: string;
    images?: AttachedImage[];
    searchGrounding?: boolean;
    selectedAspectRatio?: AspectRatio;
    isShared?: boolean;
  }) => {
    const { prompt, model, aspectRatio, quality, workspaceId, images } = params;
    const pendingId = randomUUID();
    const controller = new AbortController();
    abortControllersRef.current.set(pendingId, controller);

    setPending((prev) => [
      { id: pendingId, prompt, aspectRatio, selectedAspectRatio: params.selectedAspectRatio, count: 1, workspaceId, startedAt: Date.now(), model, quality, images, searchGrounding: params.searchGrounding },
      ...prev,
    ]);

    let shouldRetain = false;
    try {
      const data = await generateImage(prompt, model, aspectRatio, images, quality, controller.signal, params.searchGrounding, workspaceId, params.isShared, params.selectedAspectRatio, (jobId) => {
        setPending((prev) => prev.map((p) => p.id === pendingId ? { ...p, jobId } : p));
      });
      const meta: GeneratedImageMeta = {
        id: data.imageId,
        prompt,
        model,
        aspectRatio,
        mimeType: data.mimeType,
        width: data.width,
        height: data.height,
        timestamp: Date.now(),
        quality,
        searchGrounding: data.grounded ?? params.searchGrounding,
        selectedAspectRatio: params.selectedAspectRatio,
        thumbnailUrl: data.thumbnailUrl,
        workspaceId: params.isShared ? undefined : (workspaceId || "main"),
        referenceImageDataUrls: data.referenceImageDataUrls,
      };
      dispatch({ type: "ADD_IMAGE", payload: meta });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      shouldRetain = true;
      const errorMessage = err instanceof Error ? err.message : "Generation failed";
      addFailedJob({
        id: pendingId,
        prompt,
        model,
        aspectRatio,
        selectedAspectRatio: params.selectedAspectRatio,
        quality,
        workspaceId,
        searchGrounding: params.searchGrounding,
        images: trimImagesForStorage(images),
        errorMessage,
        failedAt: Date.now(),
      });
      setPending((prev) =>
        prev.map((p) => p.id === pendingId ? { ...p, failed: true, errorMessage } : p)
      );
      pushErrorToast(errorMessage);
    } finally {
      abortControllersRef.current.delete(pendingId);
      if (!shouldRetain) {
        setPending((prev) => prev.filter((p) => p.id !== pendingId));
      }
    }
  }, [dispatch, pushErrorToast]);

  const MAX_CONCURRENT = 8;

  const handleGenerate = useCallback(
    async (prompt: string, images?: AttachedImage[]) => {
      const activeSlots = pendingRef.current
        .filter((p) => !p.failed)
        .reduce((sum, p) => sum + p.count, 0) + remotePendingRef.current.length;

      if (activeSlots >= MAX_CONCURRENT) return;

      const effectiveBatchSize = Math.min(state.batchSize, MAX_CONCURRENT - activeSlots);

      let effectiveAspectRatio: AspectRatio = state.aspectRatio === "Auto" ? "1:1" : state.aspectRatio;

      if (state.aspectRatio === "Auto" && images && images.length > 0) {
        const refDims = await getRefImageDimensions(images[0]);
        effectiveAspectRatio = closestAspectRatio(refDims.width, refDims.height);
      }

      const params = {
        prompt,
        model: state.selectedModel,
        aspectRatio: effectiveAspectRatio,
        selectedAspectRatio: state.aspectRatio,
        quality: state.quality,
        workspaceId: state.currentWorkspaceId,
        images,
        searchGrounding: state.searchGrounding,
      };
      for (let i = 0; i < effectiveBatchSize; i++) {
        runGeneration(params);
      }
    },
    [state.selectedModel, state.aspectRatio, state.batchSize, state.quality, state.currentWorkspaceId, state.searchGrounding, runGeneration]
  );

  const handleCancel = useCallback((pendingId: string) => {
    const controller = abortControllersRef.current.get(pendingId);
    if (controller) controller.abort();
    // Always do full cleanup immediately. For regular jobs the runGeneration
    // finally block also cleans up (harmless double-run). For orphan-recovery
    // jobs the polling IIFE just silently returns on abort with no finally, so
    // this is the only place cleanup happens.
    setPending((prev) => prev.filter((p) => p.id !== pendingId));
    // For remote pending items (id === jobId), remove from AppContext state too.
    dispatch({ type: "REMOVE_REMOTE_PENDING", payload: pendingId });
    removePendingJob(pendingId);
    removeFailedJob(pendingId);
    abortControllersRef.current.delete(pendingId);
    // Notify the server to cancel — use the server jobId if available (local pending
    // items have a separate client-side pendingId; remote items use jobId as their id).
    const serverJobId = pendingRef.current.find((p) => p.id === pendingId)?.jobId ?? pendingId;
    fetch(`/api/generate/${serverJobId}`, { method: "DELETE" }).catch(() => {});
  }, [dispatch]);

  const handleRetry = useCallback((pendingId: string) => {
    const failed = pendingRef.current.find((p) => p.id === pendingId && p.failed);
    if (!failed) return;

    // Diagnostic: log exactly what will be re-sent so it's easy to spot if
    // images are silently missing or empty from a retry attempt.
    if (failed.images && failed.images.length > 0) {
      console.log(
        `[HomeField] Retry: re-sending ${failed.images.length} reference image(s) ` +
        `(${failed.images.map((img) => `${img.mimeType} ${Math.round(img.base64.length / 1024)}KB`).join(", ")}) ` +
        `with prompt "${failed.prompt.slice(0, 60)}"`
      );
    } else {
      console.log(`[HomeField] Retry: no reference images for prompt "${failed.prompt.slice(0, 60)}"`);
    }

    setPending((prev) => prev.filter((p) => p.id !== pendingId));
    removeFailedJob(pendingId);
    runGeneration({
      prompt: failed.prompt,
      model: failed.model,
      aspectRatio: failed.aspectRatio as AspectRatio,
      selectedAspectRatio: (failed.selectedAspectRatio ?? failed.aspectRatio) as AspectRatio,
      quality: failed.quality,
      workspaceId: failed.workspaceId,
      images: failed.images,
      searchGrounding: failed.searchGrounding,
    });
  }, [runGeneration]);

  const openTemplate  = useCallback(() => setTemplateOpen(true),  []);
  const closeTemplate = useCallback(() => setTemplateOpen(false), []);

  const handleTemplateSelect = useCallback((content: string, sourceRect: DOMRect) => {
    setTemplateOpen(false);

    if (window.innerWidth < 640) {
      mobilePromptSetterRef.current?.(content);
      return;
    }

    // Set prompt immediately so the textarea resizes before we measure it
    promptSetterRef.current?.(content);

    // CommandBar schedules its resize with setTimeout(fn, 0) — wait a frame
    // after that so we read the already-resized rect
    setTimeout(() => {
      const toRect = textareaRectRef.current?.();
      if (!toRect) return;

      setBeamProps({
        from:   { x: sourceRect.left + sourceRect.width  / 2, y: sourceRect.top  + sourceRect.height / 2 },
        to:     { x: toRect.left     + toRect.width      / 2, y: toRect.top      + toRect.height     / 2 },
        toSize: { width: toRect.width, height: toRect.height },
      });
    }, 20);
  }, []);

  // Only pass pending items for the current workspace to Gallery.
  // Merges local pending (from this device) and remote pending (from other devices via SSE).
  const workspacePending = useMemo(
    () => [
      ...pending
        .filter((p) => p.workspaceId === state.currentWorkspaceId)
        .map((p) => ({
          ...p,
          generating: state.processingJobIds.includes(p.jobId ?? "") || undefined,
        })),
      ...state.remotePending
        .filter((p) => (p.workspaceId ?? "main") === state.currentWorkspaceId)
        .map((p) => ({
          id: p.jobId,
          prompt: p.prompt,
          aspectRatio: p.aspectRatio,
          selectedAspectRatio: p.selectedAspectRatio,
          count: 1,
          workspaceId: p.workspaceId ?? "main",
          startedAt: p.startedAt,
          model: p.model,
          quality: p.quality,
          generating: state.processingJobIds.includes(p.jobId) || undefined,
          // Only remote pendings can be an agent's; the local branch above is
          // this tab's own work and is never badged.
          agentLabel: p.agentLabel,
        })),
    ],
    [pending, state.currentWorkspaceId, state.remotePending, state.processingJobIds],
  );

  return (
    <>
      <Header onOpenTemplate={openTemplate} />
      <SettingsModal />
      <CredentialModal />
      <MediaKeyBanner />
      <TemplateDrawer
        open={templateOpen}
        onClose={closeTemplate}
        onSelectPrompt={handleTemplateSelect}
      />

      <main>
        <Gallery
          pending={workspacePending}
          onPromptSelect={handlePromptSelect}
          onRestore={handleRestore}
          onReference={handleReference}
          onBatchDelete={handleBatchDelete}
          onBatchDownload={handleBatchDownload}
          onBatchModeChange={setBatchMode}
          onBatchCopyTo={handleBatchCopyTo}
          onBatchMoveTo={handleBatchMoveTo}
          onCancel={handleCancel}
          onRetry={handleRetry}
        />
      </main>

      <CommandBar
        onGenerate={handleGenerate}
        promptRef={promptSetterRef}
        restoreRef={restoreRef}
        addImageRef={addImageRef}
        textareaRectRef={textareaRectRef}
        batchMode={batchMode}
      />
      <MobilePromptSheet
        onGenerate={handleGenerate}
        promptRef={mobilePromptSetterRef}
        restoreRef={mobileRestoreRef}
        addImageRef={mobileAddImageRef}
      />

      {beamProps && (
        <BeamOverlay
          from={beamProps.from}
          to={beamProps.to}
          toSize={beamProps.toSize}
          onComplete={() => setBeamProps(null)}
        />
      )}

      <ErrorToasts toasts={errorToasts} onDismiss={dismissErrorToast} />
    </>
  );
}
