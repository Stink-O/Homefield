import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { checkRateLimit } from "@/lib/rateLimit";

// OWASP: limit username characters to prevent homograph attacks and unexpected DB behaviour.
const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;

export async function POST(req: NextRequest) {
  // OWASP: Rate limit registration by IP — 5 attempts per hour prevents account-spam abuse.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = checkRateLimit(`register:${ip}`, 5, 60 * 60 * 1000);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
    return NextResponse.json(
      { error: "Too many registration attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  // OWASP: Always wrap req.json() — a malformed body must return 400, not a 500 stack trace.
  let body: { username?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
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
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }
  // OWASP: Cap password length to prevent bcrypt DoS (bcrypt silently truncates at 72 bytes).
  if (password.length > 128) {
    return NextResponse.json({ error: "Password must be at most 128 characters" }, { status: 400 });
  }

  const existing = await db.query.users.findFirst({ where: eq(users.username, username.trim()) });
  if (existing) {
    return NextResponse.json({ error: "Username already taken" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const id = crypto.randomUUID();

  await db.insert(users).values({
    id,
    username: username.trim(),
    email: null,
    passwordHash,
    role: "user",
    approved: false, // requires admin approval
    createdAt: Date.now(),
  });

  return NextResponse.json({ success: true }, { status: 201 });
}
