// Shared guards for every MCP tool.
//
// Scope, destination and ownership are enforced here rather than in each tool,
// so a new tool cannot forget one of them: it either calls requireScope /
// requireAccessibleImage / resolveWorkspaceTarget, or it touches no data.
//
// Nothing here trusts a value that arrived from the agent. Workspace ids in
// particular are checked against both the key's destination mode and the
// owning user before they are allowed anywhere near a query.

import { and, eq } from "drizzle-orm";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { db } from "@/lib/db";
import { images, workspaces } from "@/lib/db/schema";
import type { AgentDenialReason, AgentPrincipal, AgentScope } from "@/lib/agent/contract";

export type ImageRow = typeof images.$inferSelect;

/** The literal an agent passes to mean "the user's Main library" (workspace NULL). */
export const MAIN_WORKSPACE = "main";
/** Pseudo-workspace meaning "read across every workspace". Reads only, mode `any` only. */
export const ALL_WORKSPACES = "all";

/**
 * A refusal that is the agent's fault, not the server's. Thrown by the guards
 * and converted by runTool() into a tool error carrying the contract's
 * AgentDenialReason, so a client can branch on the reason rather than parse
 * English.
 */
export class AgentToolError extends Error {
  constructor(readonly reason: AgentDenialReason | "not_found" | "invalid_input", message: string) {
    super(message);
    this.name = "AgentToolError";
  }
}

export function toolText(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function toolJson(value: unknown, note?: string): CallToolResult {
  const body = JSON.stringify(value, null, 2);
  return toolText(note ? `${note}\n\n${body}` : body);
}

export function toolFailure(reason: string, message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: `[${reason}] ${message}` }] };
}

/**
 * Runs a tool body, turning guard failures into structured tool errors and
 * anything unexpected into a generic one. Internal error text never reaches the
 * agent — it goes to the server log.
 */
export async function runTool(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AgentToolError) return toolFailure(err.reason, err.message);
    console.error("[mcp] tool failed", err);
    return toolFailure("internal_error", "The tool failed. Check the HomeField server logs.");
  }
}

/** Throws unless the key was minted with `scope`. */
export function requireScope(principal: AgentPrincipal, scope: AgentScope): void {
  if (!principal.scopes.includes(scope)) {
    throw new AgentToolError(
      "missing_scope",
      `This API key does not hold the "${scope}" scope. Grant it in HomeField Settings and mint a new key.`,
    );
  }
}

/** Human-readable description of where this key may write. Used in tool descriptions. */
export function describeDestination(principal: AgentPrincipal): string {
  const target = principal.defaultWorkspaceId
    ? `workspace ${principal.defaultWorkspaceId}`
    : "the owner's Main library";
  switch (principal.destinationMode) {
    case "own":
      return `This key writes only into its own workspace (${target}). Omit workspace_id; passing any other value is refused rather than redirected.`;
    case "pinned":
      return `This key writes only into its pinned ${target}. Omit workspace_id; passing any other value is refused rather than redirected.`;
    case "any":
      return `This key may write into any of the owner's workspaces. Pass workspace_id, or "${MAIN_WORKSPACE}" for the Main library. Defaults to ${target}.`;
  }
}

/**
 * Turns an agent-supplied workspace id into a real, permitted workspace id (or
 * null for Main).
 *
 * Under "own" and "pinned" the key has exactly one legal destination, so any
 * other id is refused outright rather than silently redirected — an agent that
 * thinks it wrote somewhere else should find out.
 */
export async function resolveWorkspaceTarget(
  principal: AgentPrincipal,
  requested: string | null | undefined,
): Promise<string | null> {
  const fallback = principal.defaultWorkspaceId;

  if (principal.destinationMode !== "any") {
    if (requested === undefined || requested === null) return fallback;
    const normalized = requested === MAIN_WORKSPACE ? null : requested;
    if (normalized !== fallback) {
      throw new AgentToolError(
        "workspace_forbidden",
        `This API key is restricted to ${fallback ? `workspace ${fallback}` : "the Main library"} and cannot address another workspace.`,
      );
    }
    return fallback;
  }

  if (requested === undefined || requested === null) return fallback;
  if (requested === MAIN_WORKSPACE) return null;
  return assertOwnedWorkspace(principal, requested);
}

/** Confirms a workspace exists and belongs to the key's owner. */
export async function assertOwnedWorkspace(principal: AgentPrincipal, workspaceId: string): Promise<string> {
  const ws = await db.query.workspaces.findFirst({
    where: and(eq(workspaces.id, workspaceId), eq(workspaces.userId, principal.userId)),
  });
  if (!ws) {
    throw new AgentToolError("workspace_forbidden", `Workspace ${workspaceId} does not exist or does not belong to this account.`);
  }
  return ws.id;
}

/**
 * Resolves the workspace filter for a read.
 *
 * Reads obey the destination too. A key confined to one workspace has no
 * business enumerating the rest of its owner's library — being able to read
 * every image is most of the value of being able to write to every workspace.
 *
 * Returns `undefined` to mean "no workspace filter" (mode `any` reading "all").
 */
export async function resolveWorkspaceFilter(
  principal: AgentPrincipal,
  requested: string | null | undefined,
): Promise<string | null | undefined> {
  if (principal.destinationMode !== "any") {
    if (requested !== undefined && requested !== null && requested !== MAIN_WORKSPACE && requested !== principal.defaultWorkspaceId) {
      throw new AgentToolError(
        "workspace_forbidden",
        `This API key can only read ${principal.defaultWorkspaceId ? `workspace ${principal.defaultWorkspaceId}` : "the Main library"}.`,
      );
    }
    return principal.defaultWorkspaceId;
  }
  if (requested === ALL_WORKSPACES) return undefined;
  if (requested === undefined || requested === null) return principal.defaultWorkspaceId;
  if (requested === MAIN_WORKSPACE) return null;
  return assertOwnedWorkspace(principal, requested);
}

/**
 * Loads an image the key is allowed to touch: owned by the key's user, not a
 * shared copy, and inside the key's destination unless the mode is `any`.
 *
 * Shared copies are excluded deliberately. They point at the same file on disk
 * as their source (see app/api/images/[id]/share/route.ts), so deleting one as
 * if it were a normal image would take the original's pixels with it.
 * unpublish_image handles those instead.
 */
export async function requireAccessibleImage(principal: AgentPrincipal, imageId: string): Promise<ImageRow> {
  const row = await db.query.images.findFirst({
    where: and(
      eq(images.id, imageId),
      eq(images.userId, principal.userId),
      eq(images.isShared, false),
    ),
  });
  if (!row) {
    throw new AgentToolError("not_found", `Image ${imageId} was not found in this account's library.`);
  }
  if (principal.destinationMode !== "any" && row.workspaceId !== principal.defaultWorkspaceId) {
    throw new AgentToolError(
      "workspace_forbidden",
      `Image ${imageId} is outside the workspace this API key is restricted to.`,
    );
  }
  return row;
}

/** Metadata projection handed to the agent. Never includes file system paths. */
export function imageSummary(row: ImageRow): Record<string, unknown> {
  return {
    id: row.id,
    workspace_id: row.workspaceId ?? MAIN_WORKSPACE,
    prompt: row.prompt,
    model: row.model,
    aspect_ratio: row.aspectRatio,
    quality: row.quality,
    width: row.width,
    height: row.height,
    mime_type: row.mimeType,
    created_at: new Date(row.timestamp).toISOString(),
    origin: row.origin,
    agent_label: row.agentLabel,
    resource_uri: imageResourceUri(row.id),
  };
}

export function imageResourceUri(imageId: string): string {
  return `homefield://image/${imageId}`;
}
