// Signed, short-lived image download for agents.
//
// This is the one route outside /api/mcp that an agent-issued credential can
// reach, and it does exactly one thing: hand over the bytes of a single image
// the minting key was already allowed to read through the MCP tools.
//
// It is NOT authenticated by the bearer token. The model does not know its own
// token (it lives in MCP client config), so a header-based design could not be
// carried out by the agent. Instead the tool result carries a URL signed by the
// server, and this route verifies that signature.
//
// The grant is narrower than the key that minted it in every dimension: one
// image, a few minutes, and it stops working the instant the key is revoked or
// its owner is un-approved — both re-checked here on every request, matching
// the stance in lib/agent/auth.ts rather than trusting the signature alone.
//
// Unlike the homefield://image/{id} resource there is no size cap, because
// these bytes go to a file on the caller's disk and never into a context window.

import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import fs from "fs/promises";
import { Readable } from "stream";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKeys, users } from "@/lib/db/schema";
import { verifyDownloadGrant } from "@/lib/agent/downloadToken";
import { resolveDefaultWorkspace } from "@/lib/agent/auth";
import { requireAccessibleImage } from "@/lib/mcp/context";
import { resolveStoragePath } from "@/lib/mcp/preview";
import { checkRateLimit } from "@/lib/rateLimit";
import type { AgentPrincipal, AgentScope, DestinationMode } from "@/lib/agent/contract";
import { parseScopes } from "@/lib/agent/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One shape for every refusal: a bad signature must not be distinguishable from a missing image. */
function refuse(): NextResponse {
  return NextResponse.json(
    { error: "This download link is invalid or has expired. Ask the agent to fetch a fresh one." },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const imageId = decodeURIComponent(rawId);
  const { searchParams } = req.nextUrl;
  const keyId = searchParams.get("k");
  if (!keyId) return refuse();

  const grant = verifyDownloadGrant(imageId, keyId, searchParams.get("exp"), searchParams.get("sig"));
  if (!grant.ok) return refuse();

  // A valid signature proves the URL came from us. It says nothing about
  // whether the key is still allowed to have it, so re-check that now.
  const key = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, keyId) });
  if (!key || key.revokedAt !== null) return refuse();
  if (key.expiresAt !== null && key.expiresAt <= Date.now()) return refuse();

  const owner = await db.query.users.findFirst({ where: eq(users.id, key.userId) });
  if (!owner || !owner.approved) return refuse();

  // Bandwidth ceiling per key. Generous for a real download loop, low enough
  // that a leaked URL cannot be used to hammer the instance.
  const rl = checkRateLimit(`agent-download:${keyId}`, 120, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many downloads. Retry shortly." },
      { status: 429, headers: { "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)), "cache-control": "no-store" } },
    );
  }

  // The destination is resolved exactly as requireAgentKey resolves it, and a
  // confined key whose workspace has gone is refused rather than widened: with
  // a null destination the workspace guard below would read "Main", and a
  // signed URL minted minutes ago would start serving from the owner's own
  // library. Unlike the MCP path this never re-mints an "own" workspace — a
  // GET must not create rows; the key's next tool call does that and hands
  // the agent a fresh URL.
  const defaultWorkspaceId = await resolveDefaultWorkspace(key.userId, key.defaultWorkspaceId);
  if (key.destinationMode !== "any" && !defaultWorkspaceId) return refuse();

  // The same ownership and workspace check the MCP tools apply, so a signed URL
  // can never widen what the key could reach.
  const principal: AgentPrincipal = {
    kind: "agent",
    keyId: key.id,
    userId: key.userId,
    label: key.name,
    scopes: parseScopes(key.scopes) as AgentScope[],
    destinationMode: key.destinationMode as DestinationMode,
    defaultWorkspaceId,
    limits: { maxQuality: null, maxModel: null, dailyImageLimit: null },
    usedToday: 0,
  };

  let row;
  try {
    row = await requireAccessibleImage(principal, imageId);
  } catch {
    return refuse();
  }

  let absolute: string;
  try {
    absolute = resolveStoragePath(row.filePath);
  } catch {
    return refuse();
  }

  let size: number;
  try {
    size = (await fs.stat(absolute)).size;
  } catch {
    return refuse();
  }

  // Streamed rather than buffered: this path exists for full-resolution
  // originals, which can be tens of megabytes.
  const stream = Readable.toWeb(createReadStream(absolute)) as ReadableStream;
  const ext = row.mimeType === "image/jpeg" ? "jpg" : "png";

  return new NextResponse(stream, {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="homefield-${row.id}.${ext}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
