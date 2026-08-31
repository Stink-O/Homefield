// Key management for a signed-in person, from the browser.
//
// SESSION-authenticated on purpose: this is where a human mints and reviews the
// credentials their agents use, so it goes through the same requireAuth() as
// every other UI route. Agent keys are never accepted here — an agent must not
// be able to mint itself a second key with wider scopes than the one it holds.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, workspaces } from "@/lib/db/schema";
import { requireAuth } from "@/lib/authHelpers";
import { createAgentKey, listAgentKeys, normalizeScopes } from "@/lib/agent/keys";
import { ALL_AGENT_SCOPES, DEFAULT_KEY_TTL_DAYS, type DestinationMode } from "@/lib/agent/contract";
import { MODELS, QUALITIES, type ModelId, type Quality } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_NAME_LENGTH = 60;
const MAX_TTL_DAYS = 365;
const MAX_DAILY_LIMIT = 10_000;
const DESTINATION_MODES: DestinationMode[] = ["own", "pinned", "any"];
const VALID_QUALITIES = new Set<string>(QUALITIES.map((q) => q.id));
const VALID_MODELS = new Set<string>(MODELS.map((m) => m.id));

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const keys = await listAgentKeys(auth.userId);
  return NextResponse.json({ keys }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  // The JWT was minted at login and carries no approval state. Re-read it so a
  // user un-approved since signing in cannot mint fresh long-lived credentials.
  const owner = await db.query.users.findFirst({ where: eq(users.id, auth.userId) });
  if (!owner || !owner.approved) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid request body");
  }

  const {
    name,
    scopes,
    destinationMode,
    workspaceId,
    maxQuality,
    maxModel,
    dailyImageLimit,
    expiresInDays,
  } = body;

  if (typeof name !== "string" || !name.trim()) return bad("Name required");
  if (name.trim().length > MAX_NAME_LENGTH) return bad(`Name must be ${MAX_NAME_LENGTH} characters or fewer`);

  if (scopes !== undefined) {
    if (!Array.isArray(scopes)) return bad("scopes must be an array");
    if (scopes.some((s) => typeof s !== "string" || !ALL_AGENT_SCOPES.includes(s as never))) {
      return bad(`scopes must be drawn from: ${ALL_AGENT_SCOPES.join(", ")}`);
    }
  }

  if (destinationMode !== undefined && !DESTINATION_MODES.includes(destinationMode as DestinationMode)) {
    return bad(`destinationMode must be one of: ${DESTINATION_MODES.join(", ")}`);
  }
  const mode: DestinationMode = (destinationMode as DestinationMode | undefined) ?? "own";

  if (maxQuality !== undefined && maxQuality !== null && !VALID_QUALITIES.has(String(maxQuality))) {
    return bad("Invalid maxQuality");
  }
  if (maxModel !== undefined && maxModel !== null && !VALID_MODELS.has(String(maxModel))) {
    return bad("Invalid maxModel");
  }

  if (
    dailyImageLimit !== undefined && dailyImageLimit !== null &&
    (typeof dailyImageLimit !== "number" || !Number.isInteger(dailyImageLimit) ||
      dailyImageLimit < 1 || dailyImageLimit > MAX_DAILY_LIMIT)
  ) {
    return bad(`dailyImageLimit must be an integer between 1 and ${MAX_DAILY_LIMIT}`);
  }

  if (
    expiresInDays !== undefined && expiresInDays !== null &&
    (typeof expiresInDays !== "number" || !Number.isInteger(expiresInDays) ||
      expiresInDays < 1 || expiresInDays > MAX_TTL_DAYS)
  ) {
    return bad(`expiresInDays must be an integer between 1 and ${MAX_TTL_DAYS}, or null for no expiry`);
  }

  // A key is bound to its owner. Any workspace it names must already belong to
  // that owner — otherwise "pinned" would be a way to write into someone else's
  // library by pasting their workspace id.
  let pinned: string | null = null;
  if (mode !== "own") {
    if (workspaceId !== undefined && workspaceId !== null) {
      if (typeof workspaceId !== "string") return bad("Invalid workspaceId");
      const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
      if (!ws || ws.userId !== auth.userId) return bad("Invalid workspace");
      pinned = ws.id;
    }
    if (mode === "pinned" && !pinned) {
      return bad("destinationMode 'pinned' requires a workspaceId");
    }
  }

  const { summary, token } = await createAgentKey({
    userId: auth.userId,
    name: name.trim(),
    scopes: scopes ? normalizeScopes(scopes) : undefined,
    destinationMode: mode,
    workspaceId: pinned,
    maxQuality: (maxQuality as Quality | undefined) ?? null,
    maxModel: (maxModel as ModelId | undefined) ?? null,
    dailyImageLimit: (dailyImageLimit as number | undefined) ?? null,
    expiresInDays: expiresInDays === null ? null : (expiresInDays as number | undefined) ?? DEFAULT_KEY_TTL_DAYS,
  });

  // The only response that ever contains key material. Every other read path
  // returns the summary alone.
  return NextResponse.json(
    { key: summary, token, notice: "Copy this token now — it is not stored and cannot be shown again." },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
