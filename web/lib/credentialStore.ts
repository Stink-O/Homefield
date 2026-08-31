// Encrypted-at-rest storage for Google service-account keys.
//
// Keys are stored as AES-256-GCM payloads — the instance key in the app_config
// table, per-user keys in user_credentials. The encryption key is derived from
// AUTH_SECRET (already required by the app) via scrypt, so there is no extra
// secret to manage. This protects the keys in disk backups and database dumps;
// it does not protect against an attacker who already has code execution on the
// host (they have AUTH_SECRET too). For a self-hosted app that is the right
// tradeoff.
//
// Two tiers of resolution:
//
//   resolveServiceAccount()          — the instance key. Encrypted DB value
//                                      first, then GOOGLE_APPLICATION_CREDENTIALS_JSON
//                                      so env-based installs keep working.
//   resolveCredentialsForUser(id)    — what THIS user generates with, honouring
//                                      their access tier.
//
// Access tiers (see CredentialAccess in lib/agent/contract.ts) are admin policy
// and are never written by the user-facing route:
//
//   own    — bill this user's own key. No key stored means no generation.
//   shared — permitted to fall back to the instance key.
//   none   — cannot generate at all, whatever is stored.
//
// A user on the "shared" tier who uploads their own key is billed to that key
// from then on: uploading a key is a request to pay for your own generations,
// and it takes nothing away from them, so it does not need an admin. Uploading a
// key never lifts the "none" tier.

import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appConfig, userCredentials } from "@/lib/db/schema";
import {
  ServiceAccount,
  credentialCacheKey,
  clearVertexToken,
  parseServiceAccount,
} from "@/lib/vertexAuth";
import type {
  CredentialAccess,
  CredentialSourceKind,
  ResolvedCredentials,
} from "@/lib/agent/contract";

const CONFIG_KEY = "google_credentials";
const ALGO = "aes-256-gcm";
const KDF_SALT = "homefield-cred-store-v1";

/** Matches the user_credentials.access column default. */
const DEFAULT_ACCESS: CredentialAccess = "shared";
/** cacheKey placeholder when there is no usable credential to key anything by. */
const NO_CACHE_KEY = "none";

export type CredentialSource = "db" | "env" | "none";

// ── Caches ───────────────────────────────────────────────────────────────────
//
// Resolution is memoised PER SCOPE, never in a single slot. A single global memo
// (the old __hf_sa_cache) would hand user B whatever user A resolved first, so
// B's generations would bill to A's Google project. Each entry carries the
// cacheKey the Vertex token cache is keyed by, so invalidating a credential can
// drop exactly the token minted from it and leave everyone else's alone.

const INSTANCE_SCOPE = "instance";

function userScope(userId: string): string {
  return `user:${userId}`;
}

declare global {

  var __hf_cred_cache: Map<string, ResolvedCredentials> | undefined;
}

function credCache(): Map<string, ResolvedCredentials> {
  if (!globalThis.__hf_cred_cache) {
    globalThis.__hf_cred_cache = new Map<string, ResolvedCredentials>();
  }
  return globalThis.__hf_cred_cache;
}

function unavailable(access: CredentialAccess): ResolvedCredentials {
  return { sa: null, source: "none", access, cacheKey: NO_CACHE_KEY };
}

// ── Encryption ───────────────────────────────────────────────────────────────

function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set; cannot encrypt or decrypt credentials.");
  }
  return crypto.scryptSync(secret, KDF_SALT, 32);
}

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed credential payload.");
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// ── Invalidation ─────────────────────────────────────────────────────────────

/**
 * Drops the instance credential and the access token minted from it. Every user
 * scope is dropped too, because anyone on the "shared" tier resolved through it;
 * their own tokens are keyed separately and survive.
 */
function invalidateInstance(): void {
  const cached = credCache().get(INSTANCE_SCOPE);
  if (cached && cached.cacheKey !== NO_CACHE_KEY) clearVertexToken(cached.cacheKey);
  credCache().clear();
}

/** Drops one user's resolution and, if they were on their own key, its token. */
function invalidateUser(userId: string): void {
  const scope = userScope(userId);
  const cached = credCache().get(scope);
  if (cached?.source === "user" && cached.cacheKey !== NO_CACHE_KEY) {
    clearVertexToken(cached.cacheKey);
  }
  credCache().delete(scope);
}

// ── Instance credential ──────────────────────────────────────────────────────

function resolveInstance(): ResolvedCredentials {
  const cached = credCache().get(INSTANCE_SCOPE);
  if (cached) return cached;

  let resolved: ResolvedCredentials | undefined;

  try {
    const row = db.select().from(appConfig).where(eq(appConfig.key, CONFIG_KEY)).get();
    if (row?.value) {
      const sa = parseServiceAccount(decrypt(row.value));
      resolved = { sa, source: "instance", access: "shared", cacheKey: credentialCacheKey(sa) };
    }
  } catch (err) {
    console.error("[credentialStore] failed to read stored key:", err);
  }

  if (!resolved) {
    const env = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (env) {
      try {
        const sa = parseServiceAccount(env);
        resolved = { sa, source: "env", access: "shared", cacheKey: credentialCacheKey(sa) };
      } catch (err) {
        console.error("[credentialStore] GOOGLE_APPLICATION_CREDENTIALS_JSON is invalid:", err);
      }
    }
  }

  resolved ??= unavailable("shared");
  credCache().set(INSTANCE_SCOPE, resolved);
  return resolved;
}

/**
 * Resolves the instance service account. Kept in its original shape for callers
 * that generate on the instance's behalf rather than a specific user's. Never
 * throws on a missing key — returns { sa: null, source: "none" } instead.
 */
export function resolveServiceAccount(): { sa: ServiceAccount | null; source: CredentialSource } {
  const resolved = resolveInstance();
  const source: CredentialSource =
    resolved.source === "instance" ? "db" : resolved.source === "env" ? "env" : "none";
  return { sa: resolved.sa, source };
}

/**
 * Validates and stores the instance service-account JSON (encrypted). Throws if
 * the JSON is structurally invalid. Live verification is the caller's job (see
 * verifyServiceAccount) so this stays usable offline during first-run setup.
 */
export function setStoredCredentials(rawJson: string): ServiceAccount {
  const sa = parseServiceAccount(rawJson);
  const encrypted = encrypt(rawJson);
  const now = Date.now();
  db.insert(appConfig)
    .values({ key: CONFIG_KEY, value: encrypted, updatedAt: now })
    .onConflictDoUpdate({ target: appConfig.key, set: { value: encrypted, updatedAt: now } })
    .run();
  invalidateInstance();
  return sa;
}

export function clearStoredCredentials(): void {
  db.delete(appConfig).where(eq(appConfig.key, CONFIG_KEY)).run();
  invalidateInstance();
}

export function getCredentialStatus(): {
  configured: boolean;
  source: CredentialSource;
  clientEmail: string | null;
  projectId: string | null;
} {
  const { sa, source } = resolveServiceAccount();
  return {
    configured: !!sa,
    source,
    clientEmail: sa?.client_email ?? null,
    projectId: sa?.project_id ?? null,
  };
}

// ── Per-user credentials ─────────────────────────────────────────────────────

interface UserCredentialRow {
  access: CredentialAccess;
  encryptedKey: string | null;
  clientEmail: string | null;
  projectId: string | null;
  updatedAt: number | null;
}

function readUserRow(userId: string): UserCredentialRow | null {
  try {
    const row = db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, userId))
      .get();
    if (!row) return null;
    return {
      access: row.access,
      encryptedKey: row.encryptedKey,
      clientEmail: row.clientEmail,
      projectId: row.projectId,
      updatedAt: row.updatedAt,
    };
  } catch (err) {
    console.error("[credentialStore] failed to read user credentials:", err);
    return null;
  }
}

/**
 * Resolves what a user generates with. See the tier rules at the top of the file.
 *
 * The returned cacheKey identifies the credential, not the user: two users who
 * both fall back to the instance key share one access token, while a user on
 * their own key gets a token nobody else can be handed.
 */
export function resolveCredentialsForUser(userId: string): ResolvedCredentials {
  const scope = userScope(userId);
  const cached = credCache().get(scope);
  if (cached) return cached;

  const row = readUserRow(userId);
  const access: CredentialAccess = row?.access ?? DEFAULT_ACCESS;
  let resolved: ResolvedCredentials;

  if (access === "none") {
    resolved = unavailable("none");
  } else {
    resolved = resolveFromOwnKey(row?.encryptedKey ?? null, access) ?? fallbackFor(access);
  }

  credCache().set(scope, resolved);
  return resolved;
}

function resolveFromOwnKey(
  encryptedKey: string | null,
  access: CredentialAccess,
): ResolvedCredentials | null {
  if (!encryptedKey) return null;
  try {
    const sa = parseServiceAccount(decrypt(encryptedKey));
    return { sa, source: "user", access, cacheKey: credentialCacheKey(sa) };
  } catch (err) {
    // A key that no longer decrypts (AUTH_SECRET rotated) or no longer parses
    // must not silently fall through to somebody else's billing.
    console.error("[credentialStore] stored user key is unusable:", err);
    return null;
  }
}

function fallbackFor(access: CredentialAccess): ResolvedCredentials {
  if (access !== "shared") return unavailable(access);
  const instance = resolveInstance();
  return { ...instance, access: "shared" };
}

/** What the signed-in user may see about their own credential. No key material. */
export interface UserCredentialStatus {
  access: CredentialAccess;
  hasOwnKey: boolean;
  /** Identity of the user's OWN key, null when they have not uploaded one. */
  clientEmail: string | null;
  projectId: string | null;
  updatedAt: number | null;
  /** Where generation would actually draw credentials from right now. */
  source: CredentialSourceKind;
  canGenerate: boolean;
}

export function getUserCredentialStatus(userId: string): UserCredentialStatus {
  const row = readUserRow(userId);
  const resolved = resolveCredentialsForUser(userId);
  return {
    access: resolved.access,
    hasOwnKey: !!row?.encryptedKey,
    clientEmail: row?.clientEmail ?? null,
    projectId: row?.projectId ?? null,
    updatedAt: row?.updatedAt ?? null,
    source: resolved.source,
    canGenerate: !!resolved.sa,
  };
}

/**
 * Stores a user's own service-account JSON (encrypted). Deliberately does NOT
 * touch the access tier: that is admin policy, and letting this write it would
 * let any user grant themselves the instance key or lift their own "none".
 *
 * Structural validation happens here; the live test against Google
 * (verifyServiceAccount) is the caller's job, as it is for the instance key.
 */
export function setUserCredentials(userId: string, rawJson: string): ServiceAccount {
  const sa = parseServiceAccount(rawJson);
  const encrypted = encrypt(rawJson);
  const now = Date.now();
  db.insert(userCredentials)
    .values({
      userId,
      encryptedKey: encrypted,
      clientEmail: sa.client_email,
      projectId: sa.project_id,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userCredentials.userId,
      set: {
        encryptedKey: encrypted,
        clientEmail: sa.client_email,
        projectId: sa.project_id,
        updatedAt: now,
      },
    })
    .run();
  invalidateUser(userId);
  return sa;
}

/** Removes a user's own key, leaving their admin-set access tier alone. */
export function clearUserCredentials(userId: string): void {
  db.update(userCredentials)
    .set({ encryptedKey: null, clientEmail: null, projectId: null, updatedAt: Date.now() })
    .where(eq(userCredentials.userId, userId))
    .run();
  invalidateUser(userId);
}

/** Admin-only: sets a user's access tier without disturbing their stored key. */
export function setUserAccess(userId: string, access: CredentialAccess): void {
  const now = Date.now();
  db.insert(userCredentials)
    .values({ userId, access, updatedAt: now })
    .onConflictDoUpdate({
      target: userCredentials.userId,
      set: { access, updatedAt: now },
    })
    .run();
  invalidateUser(userId);
}
