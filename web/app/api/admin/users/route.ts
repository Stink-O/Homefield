import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/authHelpers";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;
const USERNAME_MIN = 2;
const USERNAME_MAX = 32;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 72;

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const all = await db.select({
    id: users.id,
    username: users.username,
    email: users.email,
    role: users.role,
    approved: users.approved,
    createdAt: users.createdAt,
  }).from(users).orderBy(users.createdAt);

  return NextResponse.json(all);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json();
  const { username, password, role = "user", approved = true } = body as {
    username: string;
    password: string;
    role?: "admin" | "user";
    approved?: boolean;
  };

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return NextResponse.json({ error: `Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters` }, { status: 400 });
  }
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      { error: "Username may only contain letters, numbers, underscores, and hyphens" },
      { status: 400 },
    );
  }
  if (password.length < PASSWORD_MIN) {
    return NextResponse.json({ error: `Password must be at least ${PASSWORD_MIN} characters` }, { status: 400 });
  }
  if (password.length > PASSWORD_MAX) {
    return NextResponse.json({ error: `Password must be at most ${PASSWORD_MAX} characters` }, { status: 400 });
  }

  const existing = await db.query.users.findFirst({ where: eq(users.username, username) });
  if (existing) {
    return NextResponse.json({ error: "Username already taken" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const id = crypto.randomUUID();

  await db.insert(users).values({
    id,
    username,
    email: null,
    passwordHash,
    role,
    approved,
    createdAt: Date.now(),
  });

  return NextResponse.json({ id, username, role, approved }, { status: 201 });
}
