import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { checkRateLimit } from "@/lib/rateLimit";
import { setStoredCredentials } from "@/lib/credentialStore";

const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const admin = await db.query.users.findFirst({ where: eq(users.role, "admin") });
  return NextResponse.json({ setupRequired: !admin });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = checkRateLimit(`setup:${ip}`, 3, 60 * 60 * 1000);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  // Lock check — if any admin exists, setup is complete
  const existingAdmin = await db.query.users.findFirst({ where: eq(users.role, "admin") });
  if (existingAdmin) {
    return NextResponse.json({ error: "Setup has already been completed." }, { status: 403 });
  }

  let body: { username?: unknown; email?: unknown; password?: unknown; confirmPassword?: unknown; googleKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

  if (!username || !password || !email) {
    return NextResponse.json({ error: "All fields are required" }, { status: 400 });
  }
  if (username.length < 2 || username.length > 32) {
    return NextResponse.json({ error: "Username must be 2-32 characters" }, { status: 400 });
  }
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      { error: "Username may only contain letters, numbers, underscores, and hyphens" },
      { status: 400 },
    );
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }
  if (password.length > 128) {
    return NextResponse.json({ error: "Password must be at most 128 characters" }, { status: 400 });
  }
  if (password !== confirmPassword) {
    return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
  }

  const existingUsername = await db.query.users.findFirst({ where: eq(users.username, username) });
  if (existingUsername) {
    return NextResponse.json({ error: "Username already taken" }, { status: 409 });
  }

  // Optional Google service-account key. Validated structurally here (no live
  // network test, so first-run setup stays fast and works offline); the admin can
  // verify and rotate it later in Settings. Reject up front if it is malformed so
  // the user fixes it rather than discovering a bad key at first generation.
  const googleKey = typeof body.googleKey === "string" ? body.googleKey.trim() : "";
  if (googleKey) {
    try {
      const { parseServiceAccount } = await import("@/lib/vertexAuth");
      parseServiceAccount(googleKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid service-account key";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const id = crypto.randomUUID();

  try {
    await db.insert(users).values({
      id,
      username,
      email,
      passwordHash,
      role: "admin",
      approved: true,
      createdAt: Date.now(),
    });
  } catch {
    // Race condition: another request inserted an admin between our checks
    return NextResponse.json({ error: "Setup has already been completed." }, { status: 403 });
  }

  // Persist the key now that the admin exists. A storage failure here should not
  // undo a successful account creation, so it is reported but non-fatal.
  if (googleKey) {
    try {
      setStoredCredentials(googleKey);
    } catch (err) {
      console.error("[setup] failed to store Google key:", err);
      return NextResponse.json(
        { success: true, keyStored: false, keyError: "Account created, but the key could not be saved. Add it again in Settings." },
        { status: 201 },
      );
    }
  }

  return NextResponse.json({ success: true, keyStored: !!googleKey }, { status: 201 });
}
