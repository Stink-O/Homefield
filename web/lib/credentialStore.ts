// Encrypted-at-rest storage for the Google service-account key.
//
// The key is stored in the app_config table as an AES-256-GCM payload. The
// encryption key is derived from AUTH_SECRET (already required by the app) via
// scrypt, so there is no extra secret to manage. This protects the key in disk
// backups and database dumps; it does not protect against an attacker who already
// has code execution on the host (they have AUTH_SECRET too). For a self-hosted,
// single-tenant app that is the right tradeoff.
//
// Resolution order at request time: encrypted DB value first, then the
// GOOGLE_APPLICATION_CREDENTIALS_JSON env var as a fallback so existing
// env-based installs keep working unchanged.

import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appConfig } from "@/lib/db/schema";
import { ServiceAccount, parseServiceAccount } from "@/lib/vertexAuth";

const CONFIG_KEY = "google_credentials";
const ALGO = "aes-256-gcm";
const KDF_SALT = "homefield-cred-store-v1";

export type CredentialSource = "db" | "env" | "none";

declare global {

  var __hf_sa_cache: { sa: ServiceAccount | null; source: CredentialSource } | undefined;
}

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

// Drop the cached service account and the shared Vertex access token so the next
// request re-resolves from scratch. Call after any change to the stored key.
function invalidate(): void {
  globalThis.__hf_sa_cache = undefined;
  globalThis.__hf_vertex_token = undefined;
}

/**
 * Resolves the active service account: encrypted DB value first, then the env
 * var. The result is memoised on globalThis until the key changes. Never throws
 * on a missing key — returns { sa: null, source: "none" } instead.
 */
export function resolveServiceAccount(): { sa: ServiceAccount | null; source: CredentialSource } {
  if (globalThis.__hf_sa_cache) return globalThis.__hf_sa_cache;

  let result: { sa: ServiceAccount | null; source: CredentialSource } | undefined;

  try {
    const row = db.select().from(appConfig).where(eq(appConfig.key, CONFIG_KEY)).get();
    if (row?.value) {
      result = { sa: parseServiceAccount(decrypt(row.value)), source: "db" };
    }
  } catch (err) {
    console.error("[credentialStore] failed to read stored key:", err);
  }

  if (!result) {
    const env = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    result = env
      ? { sa: parseServiceAccount(env), source: "env" }
      : { sa: null, source: "none" };
  }

  globalThis.__hf_sa_cache = result;
  return result;
}

/**
 * Validates and stores a raw service-account JSON string (encrypted). Throws if
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
  invalidate();
  return sa;
}

export function clearStoredCredentials(): void {
  db.delete(appConfig).where(eq(appConfig.key, CONFIG_KEY)).run();
  invalidate();
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
