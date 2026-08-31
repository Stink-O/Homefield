/**
 * Every transition the app store can make, and the reducer that applies them.
 *
 * Separated from the provider so the transitions can be read (and reasoned
 * about) without wading through the effects that dispatch them. A handful of
 * cases deliberately write to `localStorage` or the document element as they
 * go — those are the settings that must survive a refresh or be applied before
 * the next paint, and they only ever run in response to a user action, never
 * during render.
 */

import { MODEL_QUALITIES, type GeneratedImageMeta, type ModelId, type AspectRatio, type Quality, type BatchSize, type RowHeightIndex, type Workspace } from "@/lib/types";
import { resolveTheme, type AppState, type OriginFilter, type RemotePendingItem, type Theme } from "./appState";

export type AppAction =
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
  | { type: "SET_THEME"; payload: Theme }
  | { type: "TOGGLE_SEARCH_GROUNDING" }
  | { type: "SET_SEARCH_GROUNDING"; payload: boolean }
  | { type: "SET_HISTORY_LOADING"; payload: boolean }
  | { type: "SET_ORIGIN_FILTER"; payload: OriginFilter }
  | { type: "ADD_REMOTE_PENDING"; payload: RemotePendingItem }
  | { type: "REMOVE_REMOTE_PENDING"; payload: string }
  | { type: "ADD_PROCESSING_JOB"; payload: string }
  | { type: "REMOVE_PROCESSING_JOB"; payload: string }
  | { type: "SET_MEDIA_KEY_CONFIGURED"; payload: boolean }
  | { type: "OPEN_CREDENTIAL_MODAL" }
  | { type: "CLOSE_CREDENTIAL_MODAL" };

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_MODEL": {
      // Carry the current quality over only if the new model still supports it;
      // otherwise fall back to 1K (or the model's first supported tier).
      const allowedQualities = MODEL_QUALITIES[action.payload];
      const quality = allowedQualities.includes(state.quality)
        ? state.quality
        : allowedQualities.includes("1K") ? "1K" : allowedQualities[0];
      localStorage.setItem("quality", quality);
      return {
        ...state,
        selectedModel: action.payload,
        searchGrounding: action.payload === "gemini-3.1-flash-image" ? state.searchGrounding : false,
        quality,
      };
    }
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
      // Respect the provenance filter, so a live arrival can't slip past a
      // filter the server would have excluded it from.
      if (state.originFilter !== "all" && (action.payload.origin ?? "user") !== state.originFilter) return state;
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
    case "SET_ORIGIN_FILTER": {
      if (action.payload === state.originFilter) return state;
      localStorage.setItem("originFilter", action.payload);
      // Clear the page so the refetch below can't interleave with rows the
      // new filter excludes.
      return {
        ...state,
        originFilter: action.payload,
        history: [],
        historyLoading: true,
        historyOldestTimestamp: undefined,
      };
    }
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
    case "SET_MEDIA_KEY_CONFIGURED":
      return { ...state, mediaKeyConfigured: action.payload };
    case "OPEN_CREDENTIAL_MODAL":
      return { ...state, credentialModalOpen: true };
    case "CLOSE_CREDENTIAL_MODAL":
      return { ...state, credentialModalOpen: false };
    case "SET_THEME": {
      localStorage.setItem("theme", action.payload);
      document.documentElement.setAttribute("data-theme", resolveTheme(action.payload));
      return { ...state, theme: action.payload };
    }
    default:
      return state;
  }
}
