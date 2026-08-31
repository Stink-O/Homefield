import type { AgentScope, DestinationMode } from "@/lib/agent/contract";
import type { ModelId, Quality } from "@/lib/types";

/**
 * The shapes this UI codes against. The routes are owned by another
 * workstream; field names follow lib/agent/contract.ts and the api_keys table
 * so the two sides meet without a translation layer.
 */

/** One row of GET /api/api-keys. The token itself is never in this shape. */
export interface AgentKeySummary {
  id: string;
  name: string;
  /** First characters of the token, e.g. "hf_live_9fA2c1". */
  prefix: string;
  scopes: AgentScope[];
  destinationMode: DestinationMode;
  defaultWorkspaceId: string | null;
  /** Convenience field if the route joins it; the UI resolves it locally otherwise. */
  defaultWorkspaceName?: string | null;
  maxQuality: Quality | null;
  maxModel: ModelId | null;
  dailyImageLimit: number | null;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  /** Derived: a key can be expired without having been revoked. */
  status?: "active" | "revoked" | "expired";
  /** Images this key has generated today (UTC), if the route reports it. */
  usedToday?: number;
}

/** Body of POST /api/api-keys. */
export interface CreateAgentKeyRequest {
  name: string;
  scopes: AgentScope[];
  destinationMode: DestinationMode;
  /** Existing workspace for "pinned" (and the starting one for "any"). */
  workspaceId?: string | null;
  maxQuality: Quality | null;
  maxModel: ModelId | null;
  dailyImageLimit: number | null;
  /** Omitted means the server's default lifetime; null means no expiry. */
  expiresInDays?: number | null;
}

/** POST /api/api-keys — `token` is shown once and never returned again. */
export interface CreateAgentKeyResponse {
  token: string;
  key: AgentKeySummary;
}

/** The draft an operator builds in the setup flow before the key is minted. */
export interface AgentKeyDraft {
  name: string;
  destinationMode: DestinationMode;
  /**
   * Workspace name for "own". The server names the minted workspace after the
   * agent, so an edited name is applied as a rename right after creation.
   */
  workspaceName: string;
  /** Existing workspace chosen for "pinned". */
  pinnedWorkspaceId: string;
  scopes: AgentScope[];
  maxModel: ModelId;
  maxQuality: Quality;
  dailyImageLimit: number;
}
