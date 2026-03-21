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
import {
  GeneratedImageMeta,
  ModelId,
  AspectRatio,
  Quality,
  BatchSize,
  RowHeightIndex,
  Workspace,
} from "@/lib/types";
import { getLastWorkspaceId, saveLastWorkspaceId } from "@/lib/storage";
import { pendingJobs, localJobIds } from "@/lib/gemini";

export interface RemotePendingItem {
  jobId: string;
  prompt: string;
  aspectRatio: string;
  selectedAspectRatio: string;
  model: ModelId;
  quality: Quality;
  workspaceId: string;
  startedAt: number;
}

interface AppState {
  history: GeneratedImageMeta[];
  selectedModel: ModelId;
  aspectRatio: AspectRatio;
  quality: Quality;
  batchSize: BatchSize;
  rowHeightIndex: RowHeightIndex;
  isGenerating: boolean;
  settingsOpen: boolean;
  workspaces: Workspace[];
  currentWorkspaceId: string;
  theme: "dark" | "light" | "system";
  searchGrounding: boolean;
  historyLoading: boolean;
  historyHasMore: boolean;
  historyOldestTimestamp: number | undefined;
  remotePending: RemotePendingItem[];
  processingJobIds: string[];
}

type AppAction =
  | { type: "SET_MODEL"; payload: ModelId }
  | { type: "SET_ASPECT_RATIO"; payload: AspectRatio }
  | { type: "SET_QUALITY"; payload: Quality }
  | { type: "SET_BATCH_SIZE"; payload: BatchSize }
  | { type: "SET_ROW_HEIGHT"; payload: RowHeightIndex }
  | { type: "SET_GENERATING"; payload: boolean }
  | { type: "ADD_IMAGE"; payload: GeneratedImageMeta }
  | { type: "LOAD_HISTORY"; payload: { items: GeneratedImageMeta[]; hasMore: boolean; workspaceId: string } }
  | { type: "APPEND_HISTORY"; payload: { items: GeneratedImageMeta[]; hasMore: boolean; oldestTimestamp: number | undefined } }
  | { type: "CLEAR_HISTORY" }
  | { type: "DELETE_IMAGE"; payload: string }
  | { type: "TOGGLE_SETTINGS" }
  | { type: "INIT_WORKSPACES"; payload: Workspace[] }
  | { type: "CREATE_WORKSPACE"; payload: Workspace }
  | { type: "SWITCH_WORKSPACE"; payload: string }
  | { type: "DELETE_WORKSPACE"; payload: string }
  | { type: "RENAME_WORKSPACE"; payload: { id: string; name: string } }
  | { type: "REMOVE_FROM_VIEW"; payload: string }
  | { type: "REMOVE_MANY_FROM_VIEW"; payload: string[] }
  | { type: "SET_THEME"; payload: "dark" | "light" | "system" }
  | { type: "TOGGLE_SEARCH_GROUNDING" }
  | { type: "SET_SEARCH_GROUNDING"; payload: boolean }
  | { type: "SET_HISTORY_LOADING"; payload: boolean }
  | { type: "ADD_REMOTE_PENDING"; payload: RemotePendingItem }
  | { type: "REMOVE_REMOTE_PENDING"; payload: string }
  | { type: "ADD_PROCESSING_JOB"; payload: string }
  | { type: "REMOVE_PROCESSING_JOB"; payload: string };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_MODEL":
      return {
        ...state,
        selectedModel: action.payload,
        searchGrounding: action.payload === "gemini-3.1-flash-image-preview" ? state.searchGrounding : false,
      };
    case "SET_ASPECT_RATIO":
      localStorage.setItem("aspectRatio", action.payload);
      return { ...state, aspectRatio: action.payload };
    case "SET_QUALITY":
      localStorage.setItem("quality", action.payload);
      return { ...state, quality: action.payload };
    case "SET_BATCH_SIZE":
      return { ...state, batchSize: action.payload };
    case "SET_ROW_HEIGHT":
      return { ...state, rowHeightIndex: action.payload };
    case "SET_GENERATING":
      return { ...state, isGenerating: action.payload };
    case "ADD_IMAGE": {
      // Image is already persisted server-side — just update UI state.
      const imageWorkspace = action.payload.workspaceId ?? "main";
      if (imageWorkspace !== state.currentWorkspaceId) return state;
      if (state.history.some((img) => img.id === action.payload.id)) return state;
      return { ...state, history: [action.payload, ...state.history] };
    }
    case "LOAD_HISTORY": {
      // Drop stale fetches that completed after the workspace switched.
      if (action.payload.workspaceId !== state.currentWorkspaceId) return state;
      const filtered = action.payload.items.filter(
        (img) => (img.workspaceId ?? "main") === state.currentWorkspaceId
      );
      return {
        ...state,
        history: filtered,
        historyLoading: false,
        historyHasMore: action.payload.hasMore,
        historyOldestTimestamp: filtered.length > 0 ? filtered[filtered.length - 1].timestamp : undefined,
      };
    }
    case "APPEND_HISTORY": {
      const existingIds = new Set(state.history.map((img) => img.id));
      const newItems = action.payload.items.filter((img) => !existingIds.has(img.id));
      return {
        ...state,
        history: [...state.history, ...newItems],
        historyHasMore: action.payload.hasMore,
        historyOldestTimestamp: action.payload.oldestTimestamp,
        historyLoading: false,
      };
    }
    case "CLEAR_HISTORY":
      return { ...state, history: [] };
    case "DELETE_IMAGE":
      return { ...state, history: state.history.filter((img) => img.id !== action.payload) };
    case "TOGGLE_SETTINGS":
      return { ...state, settingsOpen: !state.settingsOpen };
    case "INIT_WORKSPACES":
      return { ...state, workspaces: action.payload };
    case "CREATE_WORKSPACE":
      return { ...state, workspaces: [...state.workspaces, action.payload], currentWorkspaceId: action.payload.id, history: [], historyLoading: true };
    case "SWITCH_WORKSPACE":
      if (action.payload === state.currentWorkspaceId) return state;
      return { ...state, currentWorkspaceId: action.payload, history: [], historyLoading: true };
    case "DELETE_WORKSPACE": {
      if (action.payload === "main") return state;
      const next = state.workspaces.filter((ws) => ws.id !== action.payload);
      const wasActive = state.currentWorkspaceId === action.payload;
      return {
        ...state,
        workspaces: next,
        currentWorkspaceId: wasActive ? (next[0]?.id ?? "main") : state.currentWorkspaceId,
        history: wasActive ? [] : state.history,
      };
    }
    case "RENAME_WORKSPACE":
      return {
        ...state,
        workspaces: state.workspaces.map((ws) =>
          ws.id === action.payload.id ? { ...ws, name: action.payload.name } : ws
        ),
      };
    case "REMOVE_FROM_VIEW":
      return { ...state, history: state.history.filter((img) => img.id !== action.payload) };
    case "REMOVE_MANY_FROM_VIEW":
      return { ...state, history: state.history.filter((img) => !action.payload.includes(img.id)) };
    case "TOGGLE_SEARCH_GROUNDING":
      return { ...state, searchGrounding: !state.searchGrounding };
    case "SET_SEARCH_GROUNDING":
      return { ...state, searchGrounding: action.payload };
    case "SET_HISTORY_LOADING":
      return { ...state, historyLoading: action.payload };
    case "ADD_REMOTE_PENDING":
      if (state.remotePending.some((p) => p.jobId === action.payload.jobId)) return state;
      return { ...state, remotePending: [action.payload, ...state.remotePending] };
    case "REMOVE_REMOTE_PENDING":
      return { ...state, remotePending: state.remotePending.filter((p) => p.jobId !== action.payload) };
    case "ADD_PROCESSING_JOB":
      if (state.processingJobIds.includes(action.payload)) return state;
      return { ...state, processingJobIds: [...state.processingJobIds, action.payload] };
    case "REMOVE_PROCESSING_JOB":
      return { ...state, processingJobIds: state.processingJobIds.filter((id) => id !== action.payload) };
    case "SET_THEME": {
      localStorage.setItem("theme", action.payload);
      document.documentElement.setAttribute("data-theme", resolveTheme(action.payload));
      return { ...state, theme: action.payload };
    }
    default:
      return state;
  }
}

function getInitialTheme(): "dark" | "light" | "system" {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "dark";
}


function resolveTheme(theme: "dark" | "light" | "system"): "dark" | "light" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return theme;
}

const PAGE_SIZE = 50;
const MAX_HISTORY_IN_STATE = 200;

const initialState: AppState = {
  history: [],
  selectedModel: "gemini-3.1-flash-image-preview",
  aspectRatio: "Auto",
  quality: "2K",
  batchSize: 1,
  rowHeightIndex: 2,
  isGenerating: false,
  settingsOpen: false,
  workspaces: [{ id: "main", name: "Main", createdAt: 0 }],
  currentWorkspaceId: getLastWorkspaceId(),
  theme: getInitialTheme(),
  searchGrounding: false,
  historyLoading: true,
  historyHasMore: false,
  historyOldestTimestamp: undefined,
  remotePending: [],
  processingJobIds: [],
};

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
    if (q === "1K" || q === "2K" || q === "4K") {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // Persist the active workspace so it survives a refresh.
  useEffect(() => {
    saveLastWorkspaceId(state.currentWorkspaceId);
  }, [state.currentWorkspaceId]);

  // Reload history whenever the active workspace changes (and we have a session).
  useEffect(() => {
    if (!session?.user?.id) return;
    const workspaceId = state.currentWorkspaceId;
    fetch(`/api/images?workspaceId=${encodeURIComponent(workspaceId)}&limit=${PAGE_SIZE}`)
      .then((res) => res.ok ? res.json() : { items: [], hasMore: false })
      .then(({ items, hasMore }: { items: GeneratedImageMeta[]; hasMore: boolean }) => {
        // Include the workspaceId so the reducer can discard stale fetches that
        // complete after the workspace has already changed (race condition guard).
        dispatchRef.current({ type: "LOAD_HISTORY", payload: { items, hasMore, workspaceId } });
      })
      .catch(() => {
        dispatchRef.current({ type: "SET_HISTORY_LOADING", payload: false });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentWorkspaceId, session?.user?.id]);

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
    // TEMP DEBUG
    es.onopen = () => console.log("[HF SSE:private] connected, userId=", session?.user?.id?.slice(0, 8));
    es.onerror = (err) => console.error("[HF SSE:private] error", err);
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
        // TEMP DEBUG
        console.log("[HF SSE:private] event received id=", event.id?.slice(0, 8), "workspace=", event.workspaceId, "currentWorkspace=", state.currentWorkspaceId);
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
  }, [state.historyHasMore, state.history.length, state.currentWorkspaceId, state.historyOldestTimestamp]);

  return (
    <AppContext.Provider value={{ state, dispatch, loadMoreHistory }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
