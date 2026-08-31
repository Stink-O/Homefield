/**
 * The shape of the app-wide store, and how its first value is derived.
 *
 * Kept apart from the reducer (`appReducer.ts`) and from the provider
 * (`AppContext.tsx`) because this is the only place that reads the browser for
 * a starting value. Everything here must stay safe to evaluate during SSR:
 * `initialState` is computed at module scope, so each helper guards on
 * `typeof window` and falls back to the same default the server renders.
 */

import type {
  GeneratedImageMeta,
  ModelId,
  AspectRatio,
  Quality,
  BatchSize,
  RowHeightIndex,
  Workspace,
  ImageOrigin,
} from "@/lib/types";
import { getLastWorkspaceId } from "@/lib/storage";

/** Gallery provenance filter. "all" is the default and means no filter. */
export type OriginFilter = "all" | ImageOrigin;

export type Theme = "dark" | "light" | "system";

export interface RemotePendingItem {
  jobId: string;
  prompt: string;
  aspectRatio: string;
  selectedAspectRatio: string;
  model: ModelId;
  quality: Quality;
  workspaceId: string;
  startedAt: number;
  /**
   * Provenance for work that is still in flight. Present only when something
   * acting on the user's behalf started the generation; a generation the user
   * started in this tab is theirs by definition and carries no label.
   */
  agentLabel?: string | null;
}

export interface AppState {
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
  theme: Theme;
  searchGrounding: boolean;
  historyLoading: boolean;
  historyHasMore: boolean;
  historyOldestTimestamp: number | undefined;
  originFilter: OriginFilter;
  remotePending: RemotePendingItem[];
  processingJobIds: string[];
  // Media-generation key status. null = not yet checked.
  mediaKeyConfigured: boolean | null;
  credentialModalOpen: boolean;
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "dark";
}

function getInitialOriginFilter(): OriginFilter {
  if (typeof window === "undefined") return "all";
  const stored = localStorage.getItem("originFilter");
  return stored === "user" || stored === "agent" ? stored : "all";
}

export function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return theme;
}

/** How many images one history page requests. */
export const PAGE_SIZE = 50;
/** Ceiling on rows held in memory, so infinite scroll can't grow unbounded. */
export const MAX_HISTORY_IN_STATE = 200;

export const initialState: AppState = {
  history: [],
  selectedModel: "gemini-3.1-flash-image",
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
  originFilter: getInitialOriginFilter(),
  remotePending: [],
  processingJobIds: [],
  mediaKeyConfigured: null,
  credentialModalOpen: false,
};
