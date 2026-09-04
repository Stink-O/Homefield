// Short-lived, single-image capabilities: download grants and upload grants.
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
// Upload is the mirror image of the same problem. The only other way to get a
// file from the agent's disk into the library is `reference_images`, which
// makes the model emit the whole file as base64 inside a tool call — and even
// a 10 KB image is enough for that to fail partway through. An upload grant
// names the image id the file will occupy and the workspace it will land in,
// both fixed at mint time by the same guards every tool call goes through, so
// the route that receives the bytes has nothing to decide.
//
// Both are deliberately narrower than the key that minted them. A leaked URL
// exposes (or fills) one image for a few minutes and stops working the moment
// the key is revoked, where a leaked bearer token is ninety days of the whole
// tool set. The two purposes sign under different derived keys, so a download
// signature can never be replayed as an upload grant or vice versa.

import crypto from "crypto";

const VERSION = "v1";
/** How long a minted download URL stays valid. Long enough to download, short enough not to be a credential. */
export const DOWNLOAD_TTL_MS = 10 * 60 * 1000;
/** How long a minted upload URL stays valid. */
export const UPLOAD_TTL_MS = 10 * 60 * 1000;

/**
 * Largest file an upload grant will accept. Above the ~7.5 MB the inline
 * reference path allows, because these bytes never enter a context window,
 * but finite: the route buffers the whole body before it can validate it.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** The multipart field the upload route reads the file from. */
export const UPLOAD_FILE_FIELD = "file";
/** Upload ceiling per key: applied to minting grants and to the uploads themselves, separately. */
export const UPLOAD_RATE_LIMIT = 30;
export const UPLOAD_RATE_WINDOW_MS = 10 * 60 * 1000;

type GrantPurpose = "download" | "upload";

function signingKey(purpose: GrantPurpose): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set; cannot sign agent URLs.");
  // Derived rather than used directly so this signature can never be confused
  // with any other use of AUTH_SECRET elsewhere in the app, and derived per
  // purpose so the two grant kinds cannot be confused with each other.
  return crypto.createHash("sha256").update(`homefield-${purpose}-${VERSION}:${secret}`).digest();
}

function sign(purpose: GrantPurpose, fields: readonly string[], exp: number): string {
  const payload = [VERSION, ...fields, String(exp)].join(":");
  return crypto.createHmac("sha256", signingKey(purpose)).update(payload).digest("base64url");
}

export type GrantFailure = "malformed" | "expired" | "bad_signature";

/** Constant-time verification. Never reveals which field was wrong. */
function verify(
  purpose: GrantPurpose,
  fields: readonly string[],
  expRaw: string | null,
  sigRaw: string | null,
  now: number,
): { ok: true } | { ok: false; reason: GrantFailure } {
  if (!expRaw || !sigRaw) return { ok: false, reason: "malformed" };
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) return { ok: false, reason: "malformed" };
  if (exp <= now) return { ok: false, reason: "expired" };

  const expected = Buffer.from(sign(purpose, fields, exp), "utf8");
  const given = Buffer.from(sigRaw, "utf8");
  // timingSafeEqual throws on a length mismatch, which is itself a signal, so
  // check length first and fail the same way either way.
  if (expected.length !== given.length) return { ok: false, reason: "bad_signature" };
  if (!crypto.timingSafeEqual(expected, given)) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}

/**
 * The origin to build agent URLs against.
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

// ── Download ─────────────────────────────────────────────────────────────────

export interface DownloadGrant {
  exp: number;
  sig: string;
}

export function mintDownloadGrant(imageId: string, keyId: string, now = Date.now()): DownloadGrant {
  const exp = now + DOWNLOAD_TTL_MS;
  return { exp, sig: sign("download", [imageId, keyId], exp) };
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

export function verifyDownloadGrant(
  imageId: string,
  keyId: string,
  expRaw: string | null,
  sigRaw: string | null,
  now = Date.now(),
): { ok: true } | { ok: false; reason: GrantFailure } {
  return verify("download", [imageId, keyId], expRaw, sigRaw, now);
}

// ── Upload ───────────────────────────────────────────────────────────────────
//
// The workspace is part of the signed payload, encoded as the literal "main"
// for the owner's Main library (workspace NULL). The tool resolves it through
// resolveWorkspaceTarget() before minting, so a restricted key's grant can only
// ever name that key's own workspace, and the route re-checks it against the
// key row anyway — a caller-supplied workspace in the request body is never
// read at all.

/** The workspace field as it appears in the URL: an id, or this literal for Main. */
export const UPLOAD_WORKSPACE_MAIN = "main";

export interface UploadGrant {
  exp: number;
  sig: string;
}

export function mintUploadGrant(
  imageId: string,
  keyId: string,
  workspaceId: string | null,
  now = Date.now(),
): UploadGrant {
  const exp = now + UPLOAD_TTL_MS;
  return { exp, sig: sign("upload", [imageId, keyId, workspaceId ?? UPLOAD_WORKSPACE_MAIN], exp) };
}

export function uploadUrlFor(
  origin: string,
  imageId: string,
  keyId: string,
  workspaceId: string | null,
  now = Date.now(),
): string {
  const { exp, sig } = mintUploadGrant(imageId, keyId, workspaceId, now);
  const q = new URLSearchParams({ k: keyId, w: workspaceId ?? UPLOAD_WORKSPACE_MAIN, exp: String(exp), sig });
  return `${origin.replace(/\/+$/, "")}/api/agent/uploads/${encodeURIComponent(imageId)}?${q}`;
}

/** `workspaceRaw` is the `w` query field exactly as received; the route interprets it after this passes. */
export function verifyUploadGrant(
  imageId: string,
  keyId: string,
  workspaceRaw: string | null,
  expRaw: string | null,
  sigRaw: string | null,
  now = Date.now(),
): { ok: true } | { ok: false; reason: GrantFailure } {
  if (!workspaceRaw) return { ok: false, reason: "malformed" };
  return verify("upload", [imageId, keyId, workspaceRaw], expRaw, sigRaw, now);
}
