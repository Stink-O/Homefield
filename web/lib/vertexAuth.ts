import crypto from "crypto";

export interface ServiceAccount {
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

export function parseServiceAccount(raw: string): ServiceAccount {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON: not valid JSON");
  }
  for (const field of ["private_key", "client_email", "token_uri", "project_id"] as const) {
    if (typeof parsed[field] !== "string" || !(parsed[field] as string)) {
      throw new Error(`Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON: missing field ${field}`);
    }
  }
  return parsed as unknown as ServiceAccount;
}

export function createJWT(sa: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  })).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  return `${signingInput}.${sign.sign(sa.private_key, "base64url")}`;
}

/**
 * Performs a one-off token exchange to confirm a service account actually works,
 * without touching the shared token cache. Used when an admin saves a new key so
 * a malformed-but-parseable or revoked key is rejected at save time, not at the
 * first generation. Throws with the provider's error message on failure.
 */
export async function verifyServiceAccount(sa: ServiceAccount): Promise<void> {
  const jwt = createJWT(sa);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(sa.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
      signal: controller.signal,
    });
  } catch {
    throw new Error("Could not reach Google to verify the key. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error_description?: string }).error_description ||
        "Google rejected this key. Make sure it is a valid, active service-account key.",
    );
  }
}

/**
 * Stable identity of a service account, used to key the access-token cache.
 *
 * This is a hash, not the key itself, so it is safe to hold in memory, log or
 * pass around. Two ServiceAccount objects parsed from the same JSON produce the
 * same value; two different keys never collide. See ResolvedCredentials.cacheKey
 * in lib/agent/contract.ts.
 */
export function credentialCacheKey(sa: ServiceAccount): string {
  return crypto
    .createHash("sha256")
    .update(`${sa.client_email}\n${sa.project_id}\n${sa.private_key}`)
    .digest("hex");
}

declare global {

  var __hf_vertex_tokens: Map<string, { value: string; expiresAt: number }> | undefined;
}

function tokenCache(): Map<string, { value: string; expiresAt: number }> {
  if (!globalThis.__hf_vertex_tokens) {
    globalThis.__hf_vertex_tokens = new Map<string, { value: string; expiresAt: number }>();
  }
  return globalThis.__hf_vertex_tokens;
}

/** Drops one cached token, or all of them when no key is given. */
export function clearVertexToken(cacheKey?: string): void {
  if (!globalThis.__hf_vertex_tokens) return;
  if (cacheKey) globalThis.__hf_vertex_tokens.delete(cacheKey);
  else globalThis.__hf_vertex_tokens.clear();
}

/**
 * Exchanges the service account for a Vertex access token.
 *
 * The token is cached PER CREDENTIAL, never globally. A single global cache
 * would hand user B a token minted from user A's service account, silently
 * billing A's Google project for B's generations. Callers that already know the
 * credential's identity (see ResolvedCredentials.cacheKey) should pass it;
 * otherwise it is derived from the service account itself.
 */
export async function getAccessToken(sa: ServiceAccount, cacheKey?: string): Promise<string> {
  const key = cacheKey || credentialCacheKey(sa);
  const cache = tokenCache();
  const cached = cache.get(key);
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
    return cached.value;
  }
  const jwt = createJWT(sa);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(sa.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error_description?: string }).error_description || "Failed to get access token");
  }
  const data = await res.json() as { access_token: string; expires_in?: number };
  cache.set(key, {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}
