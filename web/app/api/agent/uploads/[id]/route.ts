// Signed, short-lived, single-use image upload for agents.
//
// The mirror of app/api/agent/images/[id]/download/route.ts. An agent that
// wants to edit a file on its disk has no way to get the bytes into the
// library: /api/import-images is session-only (and must stay that way — see
// lib/agent/auth.ts), and inlining the file as base64 in a tool call fails
// because the model has to emit every byte itself. So create_upload_url mints
// a signed grant naming the image id and workspace, and this route verifies
// the grant, takes the bytes, and creates the row.
//
// It is NOT authenticated by the bearer token, for the same reason downloads
// are not: the model does not know its own token. The grant is the credential,
// and it is narrower than the key in every dimension: one image id, one
// workspace, a few minutes, and it stops working the instant the key is
// revoked or its owner is un-approved — both re-checked here on every request
// rather than trusted from the signature.
//
// Nothing about the destination is read from the request. The workspace comes
// from the signed URL, was chosen by resolveWorkspaceTarget() at mint time, and
// is checked again here against the key row, so an "own"-mode grant cannot be
// pointed anywhere but that key's workspace. Single use falls out of the image
// id: it is the primary key of the row this request creates.
//
// Uploads are deliberately not charged against the daily generation limit.
// That budget exists because generation bills a paid API; an upload costs
// disk, and has its own per-key ceiling and file-size cap instead.

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKeys, images, users, workspaces } from "@/lib/db/schema";
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_FILE_FIELD,
  UPLOAD_RATE_LIMIT,
  UPLOAD_RATE_WINDOW_MS,
  UPLOAD_WORKSPACE_MAIN,
  verifyUploadGrant,
} from "@/lib/agent/downloadToken";
import { resolveDefaultWorkspace } from "@/lib/agent/auth";
import { parseScopes } from "@/lib/agent/keys";
import { provenanceFor, type AgentPrincipal, type DestinationMode } from "@/lib/agent/contract";
import { imageSummary } from "@/lib/mcp/context";
import { UPLOAD_MIME_TYPES } from "@/lib/mcp/schemas";
import { closestAspectRatio } from "@/lib/aspect";
import { saveImageFile } from "@/lib/fileStorage";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Multipart framing on top of the file itself: boundaries, part headers, an optional name field. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_NAME_LENGTH = 200;

/** What the bytes actually are, as sharp decodes them. Only these three formats are accepted. */
const FORMAT_TO_MIME: Record<string, (typeof UPLOAD_MIME_TYPES)[number]> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

// Grants in the middle of being consumed. The image id is the primary key, so
// two uploads of one grant cannot both create a row; this only keeps the loser
// from writing its bytes over the winner's file before the insert refuses it.
declare global {

  var __hf_uploads_in_flight: Set<string> | undefined;
}
if (!globalThis.__hf_uploads_in_flight) globalThis.__hf_uploads_in_flight = new Set<string>();
const inFlight = globalThis.__hf_uploads_in_flight;

/** One shape for every grant refusal: a bad signature must not be distinguishable from a used-up grant. */
function refuse(): NextResponse {
  return NextResponse.json(
    { error: "This upload link is invalid, has expired or has already been used. Ask the agent for a fresh one." },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

/** A problem with the file, reported only after the grant has been verified. */
function reject(status: 400 | 413 | 415, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

async function sniffMimeType(buffer: Buffer): Promise<(typeof UPLOAD_MIME_TYPES)[number] | null> {
  try {
    const meta = await sharp(buffer).metadata();
    return (meta.format && FORMAT_TO_MIME[meta.format]) || null;
  } catch {
    return null;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const imageId = decodeURIComponent(rawId);
  const { searchParams } = req.nextUrl;
  const keyId = searchParams.get("k");
  const workspaceField = searchParams.get("w");
  if (!keyId || !workspaceField) return refuse();

  const grant = verifyUploadGrant(imageId, keyId, workspaceField, searchParams.get("exp"), searchParams.get("sig"));
  if (!grant.ok) return refuse();

  // A valid signature proves the URL came from us. It says nothing about
  // whether the key is still allowed to have it, so re-check that now.
  const key = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, keyId) });
  if (!key || key.revokedAt !== null) return refuse();
  if (key.expiresAt !== null && key.expiresAt <= Date.now()) return refuse();
  if (!parseScopes(key.scopes).includes("upload")) return refuse();

  const owner = await db.query.users.findFirst({ where: eq(users.id, key.userId) });
  if (!owner || !owner.approved) return refuse();

  const rl = checkRateLimit(`agent-upload:${keyId}`, UPLOAD_RATE_LIMIT, UPLOAD_RATE_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many uploads. Retry shortly." },
      { status: 429, headers: { "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)), "cache-control": "no-store" } },
    );
  }

  // The destination is resolved exactly as requireAgentKey resolves it, and
  // then the signed workspace must agree with it. A restricted key whose
  // workspace has gone is refused rather than widened, and never re-minted
  // here — the key's next tool call does that and hands out a fresh grant.
  const defaultWorkspaceId = await resolveDefaultWorkspace(key.userId, key.defaultWorkspaceId);
  let workspaceId: string | null;
  if (key.destinationMode !== "any") {
    if (!defaultWorkspaceId || workspaceField !== defaultWorkspaceId) return refuse();
    workspaceId = defaultWorkspaceId;
  } else if (workspaceField === UPLOAD_WORKSPACE_MAIN) {
    workspaceId = null;
  } else {
    const ws = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, workspaceField), eq(workspaces.userId, key.userId)),
    });
    if (!ws) return refuse();
    workspaceId = ws.id;
  }

  // Single use: the grant's image id is the row's primary key.
  if (inFlight.has(imageId)) return refuse();
  const used = await db.query.images.findFirst({ where: eq(images.id, imageId) });
  if (used) return refuse();

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return reject(413, `File too large. The limit is ${MAX_UPLOAD_BYTES} bytes.`);
  }

  inFlight.add(imageId);
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return reject(400, `Expected a multipart/form-data body with a "${UPLOAD_FILE_FIELD}" part, e.g. curl -F "${UPLOAD_FILE_FIELD}=@image.png".`);
    }

    const part = form.get(UPLOAD_FILE_FIELD);
    if (!(part instanceof File) || part.size === 0) {
      return reject(400, `No file received. Send the image as the "${UPLOAD_FILE_FIELD}" part of a multipart/form-data body.`);
    }
    if (part.size > MAX_UPLOAD_BYTES) {
      return reject(413, `File too large. The limit is ${MAX_UPLOAD_BYTES} bytes.`);
    }

    // The bytes are what gets validated, not the declared Content-Type: curl
    // labels anything it does not recognise application/octet-stream, and a
    // label is not evidence of anything anyway.
    const buffer = Buffer.from(await part.arrayBuffer());
    const mimeType = await sniffMimeType(buffer);
    if (!mimeType) {
      return reject(415, `Unsupported image type. Accepted: ${UPLOAD_MIME_TYPES.join(", ")}.`);
    }

    const rawName = form.get("name");
    const name =
      (typeof rawName === "string" ? rawName.trim().slice(0, MAX_NAME_LENGTH) : "") ||
      part.name.replace(/\.[^.]+$/, "").trim().slice(0, MAX_NAME_LENGTH) ||
      "Uploaded image";

    const { filePath, thumbnailPath, width, height } = await saveImageFile(
      key.userId,
      imageId,
      buffer.toString("base64"),
      mimeType,
    );

    // Provenance is built from the key row exactly as requireAgentKey would
    // build it, so the image is badged as this agent's, not as the owner's.
    const principal: AgentPrincipal = {
      kind: "agent",
      keyId: key.id,
      userId: key.userId,
      label: key.name,
      scopes: parseScopes(key.scopes),
      destinationMode: key.destinationMode as DestinationMode,
      defaultWorkspaceId,
      limits: { maxQuality: null, maxModel: null, dailyImageLimit: null },
      usedToday: 0,
    };

    const row: typeof images.$inferInsert = {
      id: imageId,
      userId: key.userId,
      workspaceId,
      prompt: name,
      model: "imported",
      aspectRatio: closestAspectRatio(width, height),
      selectedAspectRatio: null,
      quality: null,
      width,
      height,
      filePath,
      thumbnailPath,
      mimeType,
      timestamp: Date.now(),
      searchGrounding: null,
      isShared: false,
      referenceImagePaths: null,
      ...provenanceFor(principal),
    };
    await db.insert(images).values(row);

    const stored = await db.query.images.findFirst({ where: eq(images.id, imageId) });
    return NextResponse.json(
      {
        image: stored ? imageSummary(stored) : { id: imageId },
        note: "Uploaded. Pass this id to generate_image via reference_image_ids to edit it.",
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } finally {
    inFlight.delete(imageId);
  }
}
