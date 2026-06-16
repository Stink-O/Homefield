import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireAdmin } from "@/lib/authHelpers";
import {
  getCredentialStatus,
  setStoredCredentials,
  clearStoredCredentials,
} from "@/lib/credentialStore";
import { parseServiceAccount, verifyServiceAccount } from "@/lib/vertexAuth";

export const dynamic = "force-dynamic";

// GET: status for any signed-in user (the gallery banner needs to know whether
// generation is available). Only admins see the resolved account identity.
export async function GET() {
  const authed = await requireAuth();
  if (authed instanceof NextResponse) return authed;

  const status = getCredentialStatus();
  const isAdmin = authed.role === "admin";
  return NextResponse.json({
    configured: status.configured,
    source: status.source,
    isAdmin,
    clientEmail: isAdmin ? status.clientEmail : null,
    projectId: isAdmin ? status.projectId : null,
  });
}

// POST: save a new key (admin only). Accepts a pasted JSON string, or
// { migrateFromEnv: true } to copy an existing env key into encrypted storage.
// The key is structurally validated and live-tested against Google before it is
// persisted, so a bad key fails here rather than at the first generation.
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  let body: { json?: unknown; migrateFromEnv?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let raw: string;
  if (body.migrateFromEnv === true) {
    raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim() ?? "";
    if (!raw) {
      return NextResponse.json(
        { error: "No environment credentials found to import." },
        { status: 400 },
      );
    }
  } else {
    raw = typeof body.json === "string" ? body.json.trim() : "";
    if (!raw) {
      return NextResponse.json({ error: "Paste your service-account JSON key." }, { status: 400 });
    }
  }

  // Structurally validate, then live-test against Google before persisting.
  try {
    const parsed = parseServiceAccount(raw);
    await verifyServiceAccount(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid credentials.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    setStoredCredentials(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not save credentials.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const status = getCredentialStatus();
  return NextResponse.json({
    configured: status.configured,
    source: status.source,
    clientEmail: status.clientEmail,
    projectId: status.projectId,
  });
}

// DELETE: remove the stored key (admin only). If an env key exists, generation
// falls back to it; the response reflects the post-delete state.
export async function DELETE() {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  clearStoredCredentials();
  const status = getCredentialStatus();
  return NextResponse.json({
    configured: status.configured,
    source: status.source,
    clientEmail: status.clientEmail,
    projectId: status.projectId,
  });
}
