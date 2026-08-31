// A signed-in user's own Google credential.
//
// Reads their tier and key identity, saves a key, clears a key. Key material is
// write-only: nothing here ever returns it, not even to its owner. The access
// tier is admin policy and is rejected outright if a client tries to send one —
// see PATCH on /api/admin/credentials.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/authHelpers";
import {
  getUserCredentialStatus,
  setUserCredentials,
  clearUserCredentials,
} from "@/lib/credentialStore";
import { parseServiceAccount, verifyServiceAccount } from "@/lib/vertexAuth";

export const dynamic = "force-dynamic";

/** Guard against a client trying to move itself between tiers. */
function rejectsAccessField(body: Record<string, unknown>): NextResponse | null {
  if ("access" in body) {
    return NextResponse.json(
      { error: "Your access tier is set by an administrator." },
      { status: 403 },
    );
  }
  return null;
}

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json(getUserCredentialStatus(auth.userId));
}

// POST: save this user's own service-account JSON. Structurally validated and
// live-tested against Google before it is persisted, so a bad key fails here
// rather than at the first generation.
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const rejected = rejectsAccessField(body);
  if (rejected) return rejected;

  const raw = typeof body.json === "string" ? body.json.trim() : "";
  if (!raw) {
    return NextResponse.json({ error: "Paste your service-account JSON key." }, { status: 400 });
  }

  try {
    const parsed = parseServiceAccount(raw);
    await verifyServiceAccount(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid credentials.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    setUserCredentials(auth.userId, raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not save credentials.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json(getUserCredentialStatus(auth.userId));
}

// DELETE: remove this user's own key. Their tier is untouched, so a "shared"
// user falls back to the instance key and an "own" user stops being able to
// generate until they upload another one.
export async function DELETE() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    clearUserCredentials(auth.userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not remove the key.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json(getUserCredentialStatus(auth.userId));
}
