// Short-lived, single-image download capabilities.
//
// An agent cannot fetch its own images over HTTP. Every file-serving route
// authenticates with a NextAuth session cookie, which an agent key deliberately
// cannot satisfy, and the model does not know its own bearer token — that lives
// in the MCP client's config (or an env var, or a keychain) and never enters the
// model's context. So a design whose command is
// `curl -H "Authorization: Bearer …"` cannot actually be carried out.
//
// The credential therefore has to arrive FROM the server, inside the tool
// result. This mints exactly that: a URL that needs no header, is good for one
// image, and expires in minutes.
//
// It is deliberately narrower than the key that minted it. A leaked URL exposes
// one image for a few minutes and stops working the moment the key is revoked,
// where a leaked bearer token is ninety days of the whole tool set.

import crypto from "crypto";

const VERSION = "v1";
/** How long a minted URL stays valid. Long enough to download, short enough not to be a credential. */
export const DOWNLOAD_TTL_MS = 10 * 60 * 1000;

function signingKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set; cannot sign download URLs.");
  // Derived rather than used directly so this signature can never be confused
  // with any other use of AUTH_SECRET elsewhere in the app.
  return crypto.createHash("sha256").update(`homefield-download-${VERSION}:${secret}`).digest();
}

function payload(imageId: string, keyId: string, exp: number): string {
  return `${VERSION}:${imageId}:${keyId}:${exp}`;
}

function sign(imageId: string, keyId: string, exp: number): string {
  return crypto.createHmac("sha256", signingKey()).update(payload(imageId, keyId, exp)).digest("base64url");
}

export interface DownloadGrant {
  exp: number;
  sig: string;
}

export function mintDownloadGrant(imageId: string, keyId: string, now = Date.now()): DownloadGrant {
  const exp = now + DOWNLOAD_TTL_MS;
  return { exp, sig: sign(imageId, keyId, exp) };
}

/**
 * Builds the absolute URL an agent can curl.
 *
 * `origin` is the origin the MCP request itself arrived on, so it is reachable
 * from the caller by construction — that is how they reached us. Note the
 * signature covers the image and the key but never the host, so a poisoned Host
 * header only produces a URL that fails for whoever forged it.
 */
export function downloadUrlFor(origin: string, imageId: string, keyId: string, now = Date.now()): string {
  const { exp, sig } = mintDownloadGrant(imageId, keyId, now);
  const q = new URLSearchParams({ k: keyId, exp: String(exp), sig });
  return `${origin.replace(/\/+$/, "")}/api/agent/images/${encodeURIComponent(imageId)}/download?${q}`;
}

/**
 * The origin to build download URLs against.
 *
 * Resolution order matters. HOMEFIELD_PUBLIC_URL wins because an admin behind a
 * proxy knows better than any header. Otherwise trust the forwarded headers,
 * then the Host. Using the request's own origin is what makes this work on a
 * self-hosted box with no public DNS: whatever address the agent reached us on
 * is, by construction, an address the agent can reach.
 */
export function originFromRequest(request: Request): string {
  const configured = process.env.HOMEFIELD_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const h = request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || /^\d/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export type GrantFailure = "malformed" | "expired" | "bad_signature";

/** Constant-time verification. Never reveals which field was wrong. */
export function verifyDownloadGrant(
  imageId: string,
  keyId: string,
  expRaw: string | null,
  sigRaw: string | null,
  now = Date.now(),
): { ok: true } | { ok: false; reason: GrantFailure } {
  if (!expRaw || !sigRaw) return { ok: false, reason: "malformed" };
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) return { ok: false, reason: "malformed" };
  if (exp <= now) return { ok: false, reason: "expired" };

  const expected = Buffer.from(sign(imageId, keyId, exp), "utf8");
  const given = Buffer.from(sigRaw, "utf8");
  // timingSafeEqual throws on a length mismatch, which is itself a signal, so
  // check length first and fail the same way either way.
  if (expected.length !== given.length) return { ok: false, reason: "bad_signature" };
  if (!crypto.timingSafeEqual(expected, given)) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}
