"use client";

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  type ReactNode,
  type Dispatch,
} from "react";
import { useSession } from "next-auth/react";
import { GeneratedImageMeta, ModelId, AspectRatio, Quality, Workspace } from "@/lib/types";
import { getLastWorkspaceId, saveLastWorkspaceId } from "@/lib/storage";
import { pendingJobs, localJobIds } from "@/lib/gemini";
import {
  initialState,
  resolveTheme,
  MAX_HISTORY_IN_STATE,
  PAGE_SIZE,
  type AppState,
} from "./appState";
import { reducer, type AppAction } from "./appReducer";

// The store's shape and its transitions live in ./appState and ./appReducer.
// The two types components consume are re-exported here so
// `@/contexts/AppContext` stays the single import path they already use.
export type { OriginFilter, RemotePendingItem } from "./appState";

const AppContext = createContext<{
  state: AppState;
  dispatch: Dispatch<AppAction>;
  loadMoreHistory: () => Promise<void>;
}>({ state: initialState, dispatch: () => {}, loadMoreHistory: async () => {} });

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const loadingRef = useRef(false);
  const { data: session } = useSession();

  // Apply the correct resolved theme before first paint to avoid a flash
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", resolveTheme(initialState.theme));
  }, []);

  // Restore persisted aspect ratio and quality after hydration so SSR and the
  // initial client render agree on defaults, avoiding hydration mismatches.
  useEffect(() => {
    const ar = localStorage.getItem("aspectRatio");
    const validAr: AspectRatio[] = ["Auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
    if (ar && validAr.includes(ar as AspectRatio)) {
      dispatch({ type: "SET_ASPECT_RATIO", payload: ar as AspectRatio });
    }
    const q = localStorage.getItem("quality");
    if (q === "512" || q === "1K" || q === "2K" || q === "4K") {
      dispatch({ type: "SET_QUALITY", payload: q });
    }
  }, []);

  // Keep data-theme in sync when system preference changes (only when theme === "system")
  useEffect(() => {
    if (state.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.setAttribute("data-theme", e.matches ? "light" : "dark");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [state.theme]);

  // Load workspaces from server on session
  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/workspaces")
      .then((res) => res.ok ? res.json() : [])
      .then(async (workspaces: Workspace[]) => {
        let list = workspaces;
        // First login: no workspaces exist yet — create a default one on the server.
        if (list.length === 0) {
          const res = await fetch("/api/workspaces", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Main" }),
          });
          if (res.ok) {
            const created: Workspace = await res.json();
            // Re-fetch all workspaces: if two devices raced to create the default
            // workspace simultaneously, both will now see the full list and converge
            // on the same workspace (list[0] = oldest by createdAt).
            const refetched = await fetch("/api/workspaces").then((r) => r.ok ? r.json() : []);
            list = refetched.length > 0 ? refetched : [created];
          }
        }
        if (list.length === 0) return; // creation failed, don't overwrite state
        dispatch({ type: "INIT_WORKSPACES", payload: list });
        // If the stored workspace ID no longer exists, switch to the first one
        const savedId = getLastWorkspaceId();
        if (!list.some((ws) => ws.id === savedId)) {
          dispatch({ type: "SWITCH_WORKSPACE", payload: list[0].id });
        }
      })
      .catch(() => {});

  }, [session?.user?.id]);

  // Persist the active workspace so it survives a refresh.
  useEffect(() => {
    saveLastWorkspaceId(state.currentWorkspaceId);
  }, [state.currentWorkspaceId]);

  // Check whether a media-generation key is configured so the gallery can prompt
  // for one when it is missing.
  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/admin/credentials")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) dispatchRef.current({ type: "SET_MEDIA_KEY_CONFIGURED", payload: !!data.configured });
      })
      .catch(() => {});
  }, [session?.user?.id]);

  // Reload history whenever the active workspace changes (and we have a session).
  useEffect(() => {
    if (!session?.user?.id) return;
    const workspaceId = state.currentWorkspaceId;
    const params = new URLSearchParams({ workspaceId, limit: String(PAGE_SIZE) });
    if (state.originFilter !== "all") params.set("origin", state.originFilter);
    fetch(`/api/images?${params}`)
      .then((res) => res.ok ? res.json() : { items: [], hasMore: false })
      .then(({ items, hasMore }: { items: GeneratedImageMeta[]; hasMore: boolean }) => {
        // Include the workspaceId so the reducer can discard stale fetches that
        // complete after the workspace has already changed (race condition guard).
        dispatchRef.current({ type: "LOAD_HISTORY", payload: { items, hasMore, workspaceId } });
      })
      .catch(() => {
        dispatchRef.current({ type: "SET_HISTORY_LOADING", payload: false });
      });

  }, [state.currentWorkspaceId, state.originFilter, session?.user?.id]);

  useEffect(() => {
    loadingRef.current = false;
  }, [state.currentWorkspaceId]);

  // Real-time cross-device sync: subscribe to image events for this user.
  // When a generation completes on any device, all logged-in sessions receive
  // it instantly via this SSE connection and add it to the gallery if it
  // belongs to the currently viewed workspace.
  useEffect(() => {
    if (!session?.user?.id) return;
    const es = new EventSource("/api/images/stream");
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);

        // Pending shimmer start: another device (or this device — filtered by localJobIds)
        // started a generation; show a shimmer card so all sessions see live progress.
        if (event._eventKind === "pending_start") {
          if (!localJobIds.has(event.jobId) && !(event.clientId && localJobIds.has(event.clientId))) {
            dispatchRef.current({
              type: "ADD_REMOTE_PENDING",
              payload: {
                jobId: event.jobId,
                prompt: event.prompt,
                aspectRatio: event.aspectRatio,
                selectedAspectRatio: event.selectedAspectRatio,
                model: event.model as ModelId,
                quality: (event.quality ?? "2K") as Quality,
                workspaceId: event.workspaceId ?? "main",
                startedAt: event.startedAt,
                // Provenance for in-flight work. Only remote pendings can carry
                // one — a generation started in this tab is filtered out above.
                agentLabel: event.agentLabel ?? null,
              },
            });
          }
          return;
        }

        // Replicate: prediction moved from queue to actively generating.
        if (event._eventKind === "pending_processing") {
          dispatchRef.current({ type: "ADD_PROCESSING_JOB", payload: event.jobId });
          return;
        }

        // Pending shimmer end: generation failed or was cancelled.
        if (event._eventKind === "pending_end") {
          dispatchRef.current({ type: "REMOVE_REMOTE_PENDING", payload: event.jobId });
          dispatchRef.current({ type: "REMOVE_PROCESSING_JOB", payload: event.jobId });
          // Immediately reject the local waitForJob promise so the error card
          // shows right away instead of waiting up to 15s for the next poll.
          const waiting = pendingJobs.get(event.jobId);
          if (waiting) {
            fetch(`/api/generate/${event.jobId}`, { cache: "no-store" })
              .then((r) => r.ok ? r.json() : null)
              .then((job) => {
                if (job?.status === "error") {
                  waiting.reject(new Error(job.error || "Generation failed"));
                }
              })
              .catch(() => {});
          }
          return;
        }

        // Image deleted on another device.
        if (event._eventKind === "image_deleted") {
          dispatchRef.current({ type: "DELETE_IMAGE", payload: event.imageId });
          return;
        }

        // Existing image completion event.
        const meta: GeneratedImageMeta = {
          id: event.id,
          prompt: event.prompt,
          model: event.model,
          aspectRatio: event.aspectRatio,
          selectedAspectRatio: event.selectedAspectRatio,
          quality: event.quality,
          width: event.width,
          height: event.height,
          thumbnailUrl: event.thumbnailUrl,
          mimeType: event.mimeType,
          timestamp: event.timestamp,
          searchGrounding: event.searchGrounding,
          workspaceId: event.workspaceId ?? "main",
          referenceImageDataUrls: event.referenceImageDataUrls,
          // Provenance: without this an agent generation arriving live would
          // show no badge until the next refresh.
          origin: event.origin ?? "user",
          agentKeyId: event.agentKeyId ?? null,
          agentLabel: event.agentLabel ?? null,
        };
        // Remove any remote pending shimmer and processing state for this job.
        dispatchRef.current({ type: "REMOVE_REMOTE_PENDING", payload: event.jobId });
        dispatchRef.current({ type: "REMOVE_PROCESSING_JOB", payload: event.jobId });
        dispatchRef.current({ type: "ADD_IMAGE", payload: meta });
        // Resolve any waitForJob promise waiting on this image (same device).
        // pendingJobs is keyed by jobId; the broadcast event carries both.
        const pending = pendingJobs.get(event.jobId);
        if (pending) {
          pending.resolve({
            imageId: event.id,
            thumbnailUrl: event.thumbnailUrl,
            width: event.width,
            height: event.height,
            mimeType: event.mimeType,
            grounded: event.searchGrounding,
            referenceImageDataUrls: event.referenceImageDataUrls,
          });
        }
      } catch { /* malformed event — ignore */ }
    };
    return () => es.close();
  }, [session?.user?.id]);

  const loadMoreHistory = useCallback(async () => {
    if (!state.historyHasMore || loadingRef.current) return;
    if (state.history.length >= MAX_HISTORY_IN_STATE) {
      dispatch({ type: "SET_HISTORY_LOADING", payload: false });
      return;
    }
    loadingRef.current = true;
    dispatch({ type: "SET_HISTORY_LOADING", payload: true });
    try {
      const params = new URLSearchParams({
        workspaceId: state.currentWorkspaceId,
        limit: String(PAGE_SIZE),
      });
      if (state.originFilter !== "all") params.set("origin", state.originFilter);
      if (state.historyOldestTimestamp !== undefined) {
        params.set("cursor", String(state.historyOldestTimestamp));
      }
      const res = await fetch(`/api/images?${params}`);
      const { items, hasMore } = res.ok ? await res.json() : { items: [], hasMore: false };
      const oldest = items.length > 0 ? items[items.length - 1].timestamp : state.historyOldestTimestamp;
      const wouldExceedCap = state.history.length + items.length >= MAX_HISTORY_IN_STATE;
      dispatch({ type: "APPEND_HISTORY", payload: { items, hasMore: hasMore && !wouldExceedCap, oldestTimestamp: oldest } });
    } catch {
      dispatch({ type: "SET_HISTORY_LOADING", payload: false });
    } finally {
      loadingRef.current = false;
    }
  }, [state.historyHasMore, state.history.length, state.currentWorkspaceId, state.originFilter, state.historyOldestTimestamp]);

  return (
    <AppContext.Provider value={{ state, dispatch, loadMoreHistory }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
