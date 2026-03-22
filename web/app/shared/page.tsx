"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useApp } from "@/contexts/AppContext";
import Header from "@/components/Header";
import CommandBar from "@/components/CommandBar";
import MobilePromptSheet from "@/components/MobilePromptSheet";
import TemplateDrawer from "@/components/TemplateDrawer";
import BeamOverlay from "@/components/BeamOverlay";
import SettingsModal from "@/components/SettingsModal";
import { generateImage, localJobIds, pendingJobs } from "@/lib/gemini";
import {
  type GeneratedImageMeta,
  type AttachedImage,
  type AspectRatio,
  type ModelId,
  type Quality,
  ASPECT_RATIOS,
} from "@/lib/types";
import { randomUUID } from "@/lib/uuid";
import { getPendingJobs, removePendingJob, addFailedJob, getFailedJobs, removeFailedJob } from "@/lib/pendingJobs";
import SharedGallery from "@/components/SharedGallery";
import type { SharedStreamEvent } from "@/lib/sharedBroadcast";

interface AttachedImageWithThumb extends AttachedImage {
  thumbnail: string;
}

interface PendingGeneration {
  id: string;
  prompt: string;
  aspectRatio: string;
  selectedAspectRatio?: string;
  count: number;
  startedAt: number;
  model: ModelId;
  quality: Quality;
  images?: AttachedImage[];
  searchGrounding?: boolean;
  failed?: boolean;
  errorMessage?: string;
}

function closestAspectRatio(width: number, height: number): AspectRatio {
  const ratio = width / height;
  const candidates = ASPECT_RATIOS.filter((ar) => ar !== "Auto") as AspectRatio[];
  let best: AspectRatio = "1:1";
  let bestDiff = Infinity;
  for (const ar of candidates) {
    const [w, h] = ar.split(":").map(Number);
    const diff = Math.abs(ratio - w / h);
    if (diff < bestDiff) { bestDiff = diff; best = ar; }
  }
  return best;
}

export default function SharedSpacePage() {
  const { state, dispatch } = useApp();
  const { data: session } = useSession();
  const [pending, setPending] = useState<PendingGeneration[]>([]);
  const [sharedImages, setSharedImages] = useState<GeneratedImageMeta[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [batchMode, setBatchMode] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [beamProps, setBeamProps] = useState<{ from: { x: number; y: number }; to: { x: number; y: number }; toSize: { width: number; height: number } } | null>(null);
  const promptSetterRef = useRef<((p: string) => void) | null>(null);
  const restoreRef = useRef<((prompt: string, images: AttachedImageWithThumb[]) => void) | null>(null);
  const addImageRef = useRef<((dataUrl: string) => void) | null>(null);
  const mobilePromptSetterRef = useRef<((p: string) => void) | null>(null);
  const mobileRestoreRef = useRef<((prompt: string, images: AttachedImageWithThumb[]) => void) | null>(null);
  const mobileAddImageRef = useRef<((dataUrl: string) => void) | null>(null);
  const textareaRectRef = useRef<(() => DOMRect | null) | null>(null);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const pendingRef = useRef<PendingGeneration[]>([]);
  const sseRef = useRef<EventSource | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => { pendingRef.current = pending; }, [pending]);

  // Load initial shared images + any server-side pending generations
  useEffect(() => {
    Promise.all([
      fetch("/api/shared/images?limit=30").then((r) => r.ok ? r.json() : { items: [], hasMore: false }),
      fetch("/api/shared/pending").then((r) => r.ok ? r.json() : []),
    ]).then(([{ items, hasMore: more }, pendingJobs]) => {
      setSharedImages(items);
      setHasMore(more);
      // Restore server-tracked pending generations as shimmers
      if (Array.isArray(pendingJobs) && pendingJobs.length > 0) {
        setPending((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          const restored = pendingJobs
            .filter((j: { jobId: string }) => !existingIds.has(j.jobId))
            .map((j: { jobId: string; prompt: string; aspectRatio: string; startedAt: number }) => ({
              id: j.jobId,
              prompt: j.prompt,
              aspectRatio: j.aspectRatio,
              selectedAspectRatio: j.aspectRatio,
              count: 1,
              startedAt: j.startedAt,
              model: state.selectedModel,
              quality: state.quality,
            }));
          return [...restored, ...prev];
        });
      }
      // Restore failed cards from previous session.
      const failedJobs = getFailedJobs().filter((j) => j.workspaceId === "shared");
      if (failedJobs.length) {
        setPending((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          const restored = failedJobs
            .filter((j) => !existingIds.has(j.id))
            .map((j) => ({
              id: j.id,
              prompt: j.prompt,
              aspectRatio: j.aspectRatio,
              count: 1 as const,
              startedAt: j.failedAt,
              model: j.model,
              quality: j.quality,
              searchGrounding: j.searchGrounding,
              failed: true as const,
              errorMessage: j.errorMessage,
            }));
          return [...restored, ...prev];
        });
      }

      setLoadingInitial(false);
    }).catch(() => setLoadingInitial(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // SSE subscription for real-time updates from other users
  useEffect(() => {
    let es: EventSource;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let dead = false;

    const handleMessage = (e: MessageEvent) => {
      if (!e.data || e.data.startsWith(":")) return;
      try {
        const event: SharedStreamEvent = JSON.parse(e.data);

        // New pending shimmer: someone started a generation in the shared space.
        // Skip if this device originated the generation — it already has a local shimmer.
        if (event._eventKind === "shared_pending_start") {
          if (localJobIds.has(event.jobId) || (event.clientId && localJobIds.has(event.clientId))) return;
          setPending((prev) => {
            if (prev.some((p) => p.id === event.jobId)) return prev;
            return [
              {
                id: event.jobId,
                prompt: event.prompt,
                aspectRatio: event.aspectRatio,
                selectedAspectRatio: event.aspectRatio,
                count: 1,
                startedAt: event.startedAt,
                model: stateRef.current.selectedModel,
                quality: stateRef.current.quality,
              },
              ...prev,
            ];
          });
          return;
        }

        // Generation failed or was cancelled.
        if (event._eventKind === "shared_pending_end") {
          if (localJobIds.has(event.jobId)) {
            // This was our own generation. The local pending item uses a client UUID
            // as its id, so the filter below won't match it — runGeneration's catch
            // block handles cleanup. Fetch status immediately so the error card
            // appears now rather than waiting up to 15s for the poll to fire.
            fetch(`/api/generate/${event.jobId}`, { cache: "no-store" })
              .then((r) => (r.ok ? r.json() : null))
              .then((job) => {
                if (job?.status === "error") {
                  pendingJobs.get(event.jobId)?.reject(new Error(job.error || "Generation failed"));
                }
              })
              .catch(() => {});
          } else {
            // Another user's generation ended — remove the shimmer we showed for them.
            setPending((prev) => prev.filter((p) => p.id !== event.jobId));
          }
          return;
        }

        // Completed image — add to gallery and clear the shimmer.
        const meta: GeneratedImageMeta = {
          id: event.id,
          userId: event.userId,
          username: event.username,
          prompt: event.prompt,
          model: event.model as ModelId,
          aspectRatio: event.aspectRatio as AspectRatio,
          mimeType: "image/png",
          width: event.width,
          height: event.height,
          timestamp: event.timestamp,
          thumbnailUrl: event.thumbnailUrl,
          referenceImageDataUrls: event.referenceImageDataUrls,
        };
        setSharedImages((prev) => {
          if (prev.some((img) => img.id === meta.id)) return prev;
          return [meta, ...prev];
        });
        if (event.jobId) {
          setPending((prev) => prev.filter((p) => p.id !== event.jobId));
        }
      } catch { /* ignore malformed events */ }
    };

    const connect = () => {
      if (dead) return;
      es = new EventSource("/api/shared/stream");
      sseRef.current = es;
      es.onmessage = handleMessage;
      es.onerror = () => {
        es.close();
        if (!dead) reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      dead = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
      sseRef.current = null;
    };
  }, []);

  const runGeneration = useCallback(async (params: {
    prompt: string;
    model: ModelId;
    aspectRatio: AspectRatio;
    quality: Quality;
    images?: AttachedImage[];
    searchGrounding?: boolean;
    selectedAspectRatio?: AspectRatio;
  }) => {
    const { prompt, model, aspectRatio, quality, images } = params;
    const pendingId = randomUUID();
    const controller = new AbortController();
    abortControllersRef.current.set(pendingId, controller);

    setPending((prev) => [
      { id: pendingId, prompt, aspectRatio, selectedAspectRatio: params.selectedAspectRatio, count: 1, startedAt: Date.now(), model, quality, images, searchGrounding: params.searchGrounding },
      ...prev,
    ]);

    let shouldRetain = false;
    try {
      const data = await generateImage(
        prompt, model, aspectRatio, images, quality,
        controller.signal, params.searchGrounding,
        undefined, // workspaceId — not used in shared space
        true, // isShared
        params.selectedAspectRatio
      );
      // SSE delivers the image to all clients in real-time. Add it here as a
      // fallback so the generating user always sees their result even if the
      // SSE event arrived before this promise resolved (dedup handles that).
      setSharedImages((prev) => {
        if (prev.some((img) => img.id === data.imageId)) return prev;
        return [{
          id: data.imageId,
          userId: session?.user?.id ?? "",
          username: session?.user?.name ?? "You",
          prompt,
          model,
          aspectRatio,
          mimeType: data.mimeType,
          width: data.width,
          height: data.height,
          timestamp: Date.now(),
          thumbnailUrl: data.thumbnailUrl,
          referenceImageDataUrls: data.referenceImageDataUrls,
        }, ...prev];
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      shouldRetain = true;
      const errorMessage = err instanceof Error ? err.message : "Generation failed";
      addFailedJob({
        id: pendingId,
        prompt,
        model,
        aspectRatio,
        quality,
        workspaceId: "shared",
        searchGrounding: params.searchGrounding,
        errorMessage,
        failedAt: Date.now(),
      });
      setPending((prev) =>
        prev.map((p) => p.id === pendingId ? { ...p, failed: true, errorMessage } : p)
      );
    } finally {
      abortControllersRef.current.delete(pendingId);
      if (!shouldRetain) {
        setPending((prev) => prev.filter((p) => p.id !== pendingId));
      }
    }
  }, []);

  const MAX_CONCURRENT = 8;

  const handleGenerate = useCallback(
    async (prompt: string, images?: AttachedImage[]) => {
      const activeSlots = pendingRef.current.filter((p) => !p.failed).reduce((sum, p) => sum + p.count, 0);
      if (activeSlots >= MAX_CONCURRENT) return;

      const slotsLeft = MAX_CONCURRENT - activeSlots;
      const count = Math.min(state.batchSize, slotsLeft);

      const refImages = images && images.length > 0 ? images : undefined;
      let effectiveAspectRatio: AspectRatio = state.aspectRatio === "Auto" ? "1:1" : state.aspectRatio;
      if (state.aspectRatio === "Auto" && refImages && refImages.length > 0) {
        const firstImg = refImages[0];
        const dims = await new Promise<{ width: number; height: number }>((resolve) => {
          const el = new window.Image();
          el.onload = () => resolve({ width: el.naturalWidth, height: el.naturalHeight });
          el.onerror = () => resolve({ width: 1024, height: 1024 });
          el.src = `data:${firstImg.mimeType};base64,${firstImg.base64}`;
        });
        effectiveAspectRatio = closestAspectRatio(dims.width, dims.height);
      }

      for (let i = 0; i < count; i++) {
        runGeneration({
          prompt,
          model: state.selectedModel,
          aspectRatio: effectiveAspectRatio,
          quality: state.quality,
          images: refImages,
          searchGrounding: state.searchGrounding,
          selectedAspectRatio: state.aspectRatio,
        });
      }
    },
    [state.batchSize, state.selectedModel, state.aspectRatio, state.quality, state.searchGrounding, runGeneration]
  );

  const handleCancel = useCallback((pendingId: string) => {
    abortControllersRef.current.get(pendingId)?.abort();
    abortControllersRef.current.delete(pendingId);
    removePendingJob(pendingId);
    removeFailedJob(pendingId);
    setPending((prev) => prev.filter((p) => p.id !== pendingId));
    fetch(`/api/generate/${pendingId}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const handleRetry = useCallback((pendingId: string) => {
    const job = pendingRef.current.find((p) => p.id === pendingId && p.failed);
    if (!job) return;
    if (job.images && job.images.length > 0) {
      console.log(
        `[HomeField] Retry: re-sending ${job.images.length} reference image(s) ` +
        `(${job.images.map((img) => `${img.mimeType} ${Math.round(img.base64.length / 1024)}KB`).join(", ")}) ` +
        `with prompt "${job.prompt.slice(0, 60)}"`
      );
    } else {
      console.log(`[HomeField] Retry: no reference images for prompt "${job.prompt.slice(0, 60)}"`);
    }
    setPending((prev) => prev.filter((p) => p.id !== pendingId));
    removeFailedJob(pendingId);
    runGeneration({
      prompt: job.prompt,
      model: job.model,
      aspectRatio: job.aspectRatio as AspectRatio,
      quality: job.quality,
      images: job.images,
      searchGrounding: job.searchGrounding,
      selectedAspectRatio: job.selectedAspectRatio as AspectRatio | undefined,
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

    promptSetterRef.current?.(content);

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

  const handleRestore = useCallback(async (image: GeneratedImageMeta) => {
    dispatch({ type: "SET_MODEL", payload: image.model });
    dispatch({ type: "SET_ASPECT_RATIO", payload: image.selectedAspectRatio ?? image.aspectRatio });
    if (image.quality) dispatch({ type: "SET_QUALITY", payload: image.quality });
    dispatch({ type: "SET_SEARCH_GROUNDING", payload: image.searchGrounding ?? false });
    promptSetterRef.current?.(image.prompt);

    const refImages: AttachedImageWithThumb[] = [];
    if (image.referenceImageDataUrls && image.referenceImageDataUrls.length > 0) {
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
    }

    restoreRef.current?.(image.prompt, refImages);
    if (window.innerWidth < 640) mobileRestoreRef.current?.(image.prompt, refImages);
  }, [dispatch]);

  const handleDeleteShared = useCallback((id: string) => {
    fetch(`/api/shared/images/${id}`, { method: "DELETE" }).catch(() => {});
    setSharedImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const handleBatchCopyToShared = useCallback(async (ids: string[], targetWorkspaceId: string) => {
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/shared/images/${id}/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: targetWorkspaceId }),
        })
      )
    );
  }, []);

  const handleBatchDeleteShared = useCallback((ids: string[]) => {
    for (const id of ids) fetch(`/api/shared/images/${id}`, { method: "DELETE" }).catch(() => {});
    const idSet = new Set(ids);
    setSharedImages((prev) => prev.filter((img) => !idSet.has(img.id)));
  }, []);

  const handleBatchDownload = useCallback(async (ids: string[]) => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    for (const id of ids) {
      const image = sharedImages.find((img) => img.id === id);
      if (!image) continue;
      const res = await fetch(`/api/images/${id}/download`);
      if (!res.ok) continue;
      const buffer = await res.arrayBuffer();
      const slug = image.prompt.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "_");
      const ext = image.mimeType === "image/jpeg" ? "jpg" : "png";
      zip.file(`${slug}_${id.slice(0, 6)}.${ext}`, buffer);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `homefield_${ids.length}_images.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  }, [sharedImages]);

  const handleReference = useCallback(async (image: GeneratedImageMeta) => {
    const res = await fetch(`/api/images/${image.id}/download`);
    if (!res.ok) return;
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
    const b64 = btoa(chunks.join(""));
    const dataUrl = `data:${image.mimeType};base64,${b64}`;
    addImageRef.current?.(dataUrl);
    if (window.innerWidth < 640) mobileAddImageRef.current?.(dataUrl);
  }, []);

  return (
    <div data-mode="shared">
      <Header
        promptSetterRef={promptSetterRef}
        isSharedMode
        onOpenTemplate={openTemplate}
        onPromptSelect={(p) => { promptSetterRef.current?.(p); if (window.innerWidth < 640) mobilePromptSetterRef.current?.(p); }}
      />
      <SettingsModal />
      <TemplateDrawer
        open={templateOpen}
        onClose={closeTemplate}
        onSelectPrompt={handleTemplateSelect}
      />
      <SharedGallery
        images={sharedImages}
        pending={pending}
        loading={loadingInitial}
        session={session}
        workspaces={state.workspaces}
        onDelete={handleDeleteShared}
        onReference={handleReference}
        onRestore={handleRestore}
        onPromptSelect={(p) => { promptSetterRef.current?.(p); }}
        onCancel={handleCancel}
        onRetry={handleRetry}
        onBatchDelete={handleBatchDeleteShared}
        onBatchDownload={handleBatchDownload}
        onBatchCopyTo={handleBatchCopyToShared}
        onBatchModeChange={setBatchMode}
      />
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
    </div>
  );
}
