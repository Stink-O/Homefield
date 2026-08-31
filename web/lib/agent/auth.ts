// The agent principal.
//
// requireAgentKey() is the ONLY way a bearer token becomes a caller identity in
// this app, and the identity it produces is deliberately not a user session:
//
//   * It is not wired into lib/authHelpers.ts. If bearer tokens satisfied
//     requireAuth(), every REST route in the app would start accepting them
//     while knowing nothing about scopes or destination — and since
//     requireAdmin() is requireAuth() plus a role check, an admin's agent key
//     would reach user management and the Google service-account credentials.
//   * AgentPrincipal carries no role field at all, so there is no value a
//     future requireAdmin()-shaped check could read to let an agent through.
//   * Every request re-verifies the key AND the owning account. `approved` is
//     otherwise only checked at login (lib/auth.ts), so a user who is
//     un-approved by an admin would keep a live agent indefinitely — their
//     browser session dies at its next JWT refresh, but a bearer token has no
//     refresh to fail.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, workspaces } from "@/lib/db/schema";
import {
  type AgentAuthResult,
  type AgentDenial,
  type AgentDenialReason,
  type AgentPrincipal,
} from "@/lib/agent/contract";
import {
  findAgentKeyByToken,
  getDailyUsage,
  isWellFormedAgentToken,
  parseScopes,
  recordKeyUse,
} from "@/lib/agent/keys";
import type { ModelId, Quality } from "@/lib/types";

const DENIAL_STATUS: Record<AgentDenialReason, AgentDenial["status"]> = {
  missing_token: 401,
  malformed_token: 401,
  unknown_key: 401,
  revoked: 401,
  expired: 401,
  account_missing: 401,
  account_unapproved: 403,
  missing_scope: 403,
  workspace_forbidden: 403,
  quality_exceeds_limit: 403,
  model_exceeds_limit: 403,
  daily_limit_reached: 429,
  no_credentials: 403,
};

/** Builds a denial with the status the contract assigns to that reason. */
export function deny(reason: AgentDenialReason, message: string): AgentDenial {
  return { kind: "denied", reason, message, status: DENIAL_STATUS[reason] };
}

/**
 * Session cookies set by NextAuth v5 (and the v4 names, for safety). Matches
 * `authjs.session-token`, `next-auth.session-token`, their `__Secure-` /
 * `__Host-` variants, and the chunked `.0` / `.1` suffixes NextAuth uses when a
 * JWT outgrows one cookie.
 */
const SESSION_COOKIE_RE = /^(?:__Secure-|__Host-)?(?:authjs|next-auth)\.session-token(?:\.\d+)?$/;

/** True when the request carries a browser session cookie. */
export function carriesSessionCookie(request: Request): boolean {
  const header = request.headers.get("cookie");
  if (!header) return false;
  return header.split(";").some((pair) => SESSION_COOKIE_RE.test(pair.split("=")[0]?.trim() ?? ""));
}

/** Extracts the bearer token, or null when the header is absent or not bearer. */
export function bearerTokenFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer") return null;
  const token = rest.join("");
  return token.length > 0 ? token : null;
}

/**
 * Authenticates one agent request.
 *
 * Cookies are refused outright rather than ignored. HomeField issues no CSRF
 * tokens anywhere, so if this endpoint honoured — or even quietly tolerated —
 * ambient cookie authority, any page open in the owner's browser could drive
 * the entire tool set cross-origin. Requiring an explicit bearer header, which
 * a cross-origin page cannot forge, is the whole defence.
 */
export async function requireAgentKey(request: Request): Promise<AgentAuthResult> {
  if (carriesSessionCookie(request)) {
    return deny(
      "malformed_token",
      "Session cookies are not accepted here. Authenticate with an `Authorization: Bearer hf_live_…` header and send no cookies.",
    );
  }

  const token = bearerTokenFrom(request);
  if (!token) {
    return deny("missing_token", "Missing `Authorization: Bearer <api key>` header.");
  }
  if (!isWellFormedAgentToken(token)) {
    return deny("malformed_token", "Malformed API key. Expected an `hf_live_…` token.");
  }

  const key = await findAgentKeyByToken(token);
  if (!key) {
    return deny("unknown_key", "Unknown API key.");
  }

  const now = Date.now();
  if (key.revokedAt !== null) {
    return deny("revoked", "This API key has been revoked.");
  }
  if (key.expiresAt !== null && key.expiresAt <= now) {
    return deny("expired", "This API key has expired. Mint a new one from Settings.");
  }

  // Re-checked on every request, not cached: an admin un-approving an account
  // has to stop that account's agents immediately, not at some renewal.
  const owner = await db.query.users.findFirst({ where: eq(users.id, key.userId) });
  if (!owner) {
    return deny("account_missing", "The account that owns this API key no longer exists.");
  }
  if (!owner.approved) {
    return deny("account_unapproved", "The account that owns this API key is not approved.");
  }

  const defaultWorkspaceId = await resolveDefaultWorkspace(key.userId, key.defaultWorkspaceId);
  const usedToday = await getDailyUsage(key.id, now);

  await recordKeyUse(key.id, now);

  return {
    kind: "agent",
    keyId: key.id,
    userId: key.userId,
    label: key.name,
    scopes: parseScopes(key.scopes),
    destinationMode: key.destinationMode,
    defaultWorkspaceId,
    limits: {
      maxQuality: (key.maxQuality as Quality | null) ?? null,
      maxModel: (key.maxModel as ModelId | null) ?? null,
      dailyImageLimit: key.dailyImageLimit,
    },
    usedToday,
  } satisfies AgentPrincipal;
}

/**
 * Confirms the pinned workspace still exists and still belongs to the key's
 * owner. The foreign key nulls this column when a workspace is deleted, but a
 * principal is a security boundary — it re-checks rather than assuming.
 */
async function resolveDefaultWorkspace(userId: string, workspaceId: string | null): Promise<string | null> {
  if (!workspaceId) return null;
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  if (!ws || ws.userId !== userId) return null;
  return ws.id;
}

/** Renders a denial as the HTTP response the contract assigns to it. */
export function agentDenialResponse(denial: AgentDenial): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  if (denial.status === 401) {
    headers["www-authenticate"] = `Bearer error="invalid_token", error_description="${denial.reason}"`;
  }
  return new Response(
    JSON.stringify({ error: denial.message, reason: denial.reason }),
    { status: denial.status, headers },
  );
}
