// Agent API key lifecycle: mint, hash, look up, list, revoke, and count usage.
//
// The token itself is never persisted. What is stored is a SHA-256 hash plus a
// short display prefix. SHA-256 (not bcrypt) is the correct choice here: the
// token is 32 bytes of CSPRNG output, so there is no dictionary to slow down,
// and every authenticated MCP request has to verify one — a deliberately slow
// KDF would turn every tool call into a CPU burn.

import crypto from "crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKeys, apiKeyUsage, workspaces } from "@/lib/db/schema";
import {
  AGENT_KEY_BYTES,
  AGENT_KEY_DISPLAY_CHARS,
  AGENT_KEY_PREFIX,
  ALL_AGENT_SCOPES,
  DEFAULT_AGENT_SCOPES,
  DEFAULT_KEY_TTL_DAYS,
  utcDayKey,
  type AgentScope,
  type DestinationMode,
} from "@/lib/agent/contract";
import type { ModelId, Quality } from "@/lib/types";

/** Raw row as stored. Internal — never hand this to a client, it holds the hash. */
export type AgentKeyRow = typeof apiKeys.$inferSelect;

/** Safe projection for the browser. Deliberately has no `keyHash` field. */
export interface AgentKeySummary {
  id: string;
  name: string;
  /** First AGENT_KEY_DISPLAY_CHARS characters of the token, e.g. `hf_live_9fA2xQ1z`. */
  prefix: string;
  scopes: AgentScope[];
  destinationMode: DestinationMode;
  defaultWorkspaceId: string | null;
  defaultWorkspaceName: string | null;
  maxQuality: Quality | null;
  maxModel: ModelId | null;
  dailyImageLimit: number | null;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  /** Live state, derived — a key can be expired without being revoked. */
  status: "active" | "revoked" | "expired";
  usedToday: number;
}

export interface CreateAgentKeyInput {
  userId: string;
  name: string;
  scopes?: AgentScope[];
  destinationMode?: DestinationMode;
  /** Existing workspace to pin to ("pinned"), or the starting workspace ("any"). */
  workspaceId?: string | null;
  maxQuality?: Quality | null;
  maxModel?: ModelId | null;
  dailyImageLimit?: number | null;
  /** Days until expiry. Defaults to DEFAULT_KEY_TTL_DAYS; null means never. */
  expiresInDays?: number | null;
}

/** The one and only moment the token exists outside the caller's process. */
export interface MintedAgentKey {
  summary: AgentKeySummary;
  /** Plaintext token. Shown once, never stored, never re-derivable. */
  token: string;
}

// Token entropy is base64url so the token is copy-pasteable and URL-safe.
const TOKEN_BODY_CHARS = Math.ceil((AGENT_KEY_BYTES * 4) / 3); // 32 bytes -> 43 chars
const TOKEN_BODY_RE = new RegExp(`^[A-Za-z0-9_-]{${TOKEN_BODY_CHARS}}$`);

/** SHA-256 hex digest of a full token. The stored credential. */
export function hashAgentToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Shape check only — says nothing about whether the key exists. Lets the auth
 * path answer `malformed_token` without touching the database.
 */
export function isWellFormedAgentToken(token: string): boolean {
  if (!token.startsWith(AGENT_KEY_PREFIX)) return false;
  return TOKEN_BODY_RE.test(token.slice(AGENT_KEY_PREFIX.length));
}

/** Mints a fresh token and the two values derived from it that we do persist. */
export function mintAgentToken(): { token: string; keyHash: string; prefix: string } {
  const token = AGENT_KEY_PREFIX + crypto.randomBytes(AGENT_KEY_BYTES).toString("base64url");
  return {
    token,
    keyHash: hashAgentToken(token),
    prefix: token.slice(0, AGENT_KEY_DISPLAY_CHARS),
  };
}

/** Tolerant parse of the JSON scope column. Unknown entries are dropped. */
export function parseScopes(raw: string | null | undefined): AgentScope[] {
  if (!raw) return [...DEFAULT_AGENT_SCOPES];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [...DEFAULT_AGENT_SCOPES];
  }
  if (!Array.isArray(parsed)) return [...DEFAULT_AGENT_SCOPES];
  return normalizeScopes(parsed);
}

/** Keeps only recognised scopes, de-duplicated and in canonical order. */
export function normalizeScopes(input: readonly unknown[]): AgentScope[] {
  return ALL_AGENT_SCOPES.filter((s) => input.includes(s));
}

export function keyStatus(row: Pick<AgentKeyRow, "revokedAt" | "expiresAt">, now: number): AgentKeySummary["status"] {
  if (row.revokedAt !== null) return "revoked";
  if (row.expiresAt !== null && row.expiresAt <= now) return "expired";
  return "active";
}

function toSummary(row: AgentKeyRow, usedToday: number, workspaceName: string | null, now: number): AgentKeySummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: parseScopes(row.scopes),
    destinationMode: row.destinationMode,
    defaultWorkspaceId: row.defaultWorkspaceId,
    defaultWorkspaceName: workspaceName,
    maxQuality: (row.maxQuality as Quality | null) ?? null,
    maxModel: (row.maxModel as ModelId | null) ?? null,
    dailyImageLimit: row.dailyImageLimit,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    status: keyStatus(row, now),
    usedToday,
  };
}

/**
 * Creates a key for `userId`.
 *
 * Under destination mode "own" this also creates the workspace the key writes
 * into — an "own" key with a null workspace would silently fall back to the
 * user's Main library, which is exactly the blast radius the mode exists to
 * prevent. Both writes happen in one SQLite transaction so a failure cannot
 * leave an orphan workspace or a workspace-less "own" key.
 */
export async function createAgentKey(input: CreateAgentKeyInput): Promise<MintedAgentKey> {
  const now = Date.now();
  const mode: DestinationMode = input.destinationMode ?? "own";
  const scopes = input.scopes ? normalizeScopes(input.scopes) : [...DEFAULT_AGENT_SCOPES];
  const ttlDays = input.expiresInDays === undefined ? DEFAULT_KEY_TTL_DAYS : input.expiresInDays;
  const expiresAt = ttlDays === null ? null : now + ttlDays * 24 * 60 * 60 * 1000;
  const { token, keyHash, prefix } = mintAgentToken();
  const id = crypto.randomUUID();

  // "own" mints its own workspace; "pinned"/"any" use the (already ownership
  // checked) workspace the caller passed, if any.
  const ownWorkspace =
    mode === "own"
      ? { id: crypto.randomUUID(), userId: input.userId, name: input.name, createdAt: now }
      : null;
  const defaultWorkspaceId = ownWorkspace ? ownWorkspace.id : (input.workspaceId ?? null);

  const row: typeof apiKeys.$inferInsert = {
    id,
    userId: input.userId,
    name: input.name,
    keyHash,
    prefix,
    scopes: JSON.stringify(scopes),
    destinationMode: mode,
    defaultWorkspaceId,
    maxQuality: input.maxQuality ?? null,
    maxModel: input.maxModel ?? null,
    dailyImageLimit: input.dailyImageLimit ?? null,
    createdAt: now,
    lastUsedAt: null,
    expiresAt,
    revokedAt: null,
  };

  db.transaction((tx) => {
    if (ownWorkspace) tx.insert(workspaces).values(ownWorkspace).run();
    tx.insert(apiKeys).values(row).run();
  });

  const stored = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, id) });
  if (!stored) throw new Error("Failed to persist API key");

  return {
    summary: toSummary(stored, 0, ownWorkspace?.name ?? (await workspaceName(defaultWorkspaceId)), now),
    token,
  };
}

/**
 * Re-mints the workspace an "own" key writes into, and points the key at it.
 *
 * workspaces.id is ON DELETE SET NULL on api_keys, so deleting an agent's
 * workspace leaves the key with no destination. Falling back to NULL would mean
 * the Main library — the agent would start writing into its owner's personal
 * gallery, which is the one thing "own" mode exists to prevent. Recreating is
 * the only safe reading of the user's intent: they deleted a workspace, not the
 * key's confinement.
 */
export async function ensureOwnWorkspace(keyId: string): Promise<string> {
  const key = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, keyId) });
  if (!key) throw new Error("API key no longer exists");

  if (key.defaultWorkspaceId) {
    const existing = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, key.defaultWorkspaceId), eq(workspaces.userId, key.userId)),
    });
    if (existing) return existing.id;
  }

  const replacement = {
    id: crypto.randomUUID(),
    userId: key.userId,
    name: key.name,
    createdAt: Date.now(),
  };
  db.transaction((tx) => {
    tx.insert(workspaces).values(replacement).run();
    tx.update(apiKeys).set({ defaultWorkspaceId: replacement.id }).where(eq(apiKeys.id, keyId)).run();
  });
  console.warn(`[HomeField] recreated missing workspace for agent key ${key.prefix}`);
  return replacement.id;
}

async function workspaceName(id: string | null): Promise<string | null> {
  if (!id) return null;
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, id) });
  return ws?.name ?? null;
}

/** All of a user's keys, newest first. Never includes key material. */
export async function listAgentKeys(userId: string): Promise<AgentKeySummary[]> {
  const now = Date.now();
  const day = utcDayKey(now);

  const rows = await db.select().from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(asc(apiKeys.createdAt));

  const usage = await db.select().from(apiKeyUsage).where(eq(apiKeyUsage.day, day));
  const usageByKey = new Map(usage.map((u) => [u.keyId, u.imageCount]));

  const owned = await db.select().from(workspaces).where(eq(workspaces.userId, userId));
  const namesById = new Map(owned.map((w) => [w.id, w.name]));

  return rows
    .map((r) => toSummary(r, usageByKey.get(r.id) ?? 0, r.defaultWorkspaceId ? namesById.get(r.defaultWorkspaceId) ?? null : null, now))
    .reverse();
}

/**
 * Revokes a key. Scoped by userId so one user can never revoke another's key,
 * even by guessing an id. Returns false when nothing matched.
 */
export async function revokeAgentKey(userId: string, keyId: string): Promise<boolean> {
  const existing = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)),
  });
  if (!existing) return false;
  if (existing.revokedAt !== null) return true; // already revoked — idempotent
  await db.update(apiKeys)
    .set({ revokedAt: Date.now() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)));
  return true;
}

/** Looks a key up by its plaintext token. Returns null for anything unknown. */
export async function findAgentKeyByToken(token: string): Promise<AgentKeyRow | null> {
  const row = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.keyHash, hashAgentToken(token)),
  });
  return row ?? null;
}

// ── lastUsedAt debounce ──────────────────────────────────────────────────────
// lastUsedAt is a write on the hottest read path there is: every single MCP
// request. At one write per call a busy agent would hold the SQLite write lock
// continuously. A one-minute floor keeps the display honest at ~1 write/min/key.

const LAST_USED_DEBOUNCE_MS = 60_000;

declare global {

  var __hf_agent_last_used: Map<string, number> | undefined;
}
if (!globalThis.__hf_agent_last_used) {
  globalThis.__hf_agent_last_used = new Map<string, number>();
}
const lastUsedWrites = globalThis.__hf_agent_last_used;

/** Records use of a key, at most once per LAST_USED_DEBOUNCE_MS per key. */
export async function recordKeyUse(keyId: string, now: number): Promise<void> {
  const previous = lastUsedWrites.get(keyId);
  if (previous !== undefined && now - previous < LAST_USED_DEBOUNCE_MS) return;
  lastUsedWrites.set(keyId, now);
  try {
    await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, keyId));
  } catch (err) {
    // A bookkeeping write must never fail an otherwise valid request.
    lastUsedWrites.delete(keyId);
    console.error("[agent] failed to record key use", err);
  }
}

/** Test seam: clears the debounce memo. */
export function resetKeyUseDebounce(): void {
  lastUsedWrites.clear();
}

// ── Daily usage counter ──────────────────────────────────────────────────────

/** Images this key has generated during the current UTC day. */
export async function getDailyUsage(keyId: string, now: number): Promise<number> {
  const row = await db.query.apiKeyUsage.findFirst({
    where: and(eq(apiKeyUsage.keyId, keyId), eq(apiKeyUsage.day, utcDayKey(now))),
  });
  return row?.imageCount ?? 0;
}

/** Bumps the counter for the current UTC day and returns the new total. */
export async function incrementDailyUsage(keyId: string, now: number, by = 1): Promise<number> {
  const day = utcDayKey(now);
  await db.insert(apiKeyUsage)
    .values({ keyId, day, imageCount: by })
    .onConflictDoUpdate({
      target: [apiKeyUsage.keyId, apiKeyUsage.day],
      set: { imageCount: sql`${apiKeyUsage.imageCount} + ${by}` },
    });
  return getDailyUsage(keyId, now);
}
