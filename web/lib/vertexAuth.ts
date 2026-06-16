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

declare global {

  var __hf_vertex_token: { value: string; expiresAt: number } | undefined;
}

export async function getAccessToken(sa: ServiceAccount): Promise<string> {
  if (globalThis.__hf_vertex_token && globalThis.__hf_vertex_token.expiresAt - Date.now() > 5 * 60 * 1000) {
    return globalThis.__hf_vertex_token.value;
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
  globalThis.__hf_vertex_token = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return globalThis.__hf_vertex_token.value;
}
