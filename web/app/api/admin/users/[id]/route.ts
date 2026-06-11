import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/authHelpers";
import bcrypt from "bcryptjs";

const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;
const USERNAME_MIN = 2;
const USERNAME_MAX = 32;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 72;

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { approved, role, password, username } = body as {
    approved?: unknown;
    role?: unknown;
    password?: unknown;
    username?: unknown;
  };

  if (approved !== undefined && typeof approved !== "boolean") {
    return NextResponse.json({ error: "Invalid approved value" }, { status: 400 });
  }
  if (role !== undefined && role !== "admin" && role !== "user") {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
  if (password !== undefined) {
    if (typeof password !== "string" || password.length < PASSWORD_MIN) {
      return NextResponse.json({ error: `Password must be at least ${PASSWORD_MIN} characters` }, { status: 400 });
    }
    if (password.length > PASSWORD_MAX) {
      return NextResponse.json({ error: `Password must be at most ${PASSWORD_MAX} characters` }, { status: 400 });
    }
  }
  if (username !== undefined) {
    if (typeof username !== "string" || username.trim().length < USERNAME_MIN || username.trim().length > USERNAME_MAX) {
      return NextResponse.json({ error: `Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters` }, { status: 400 });
    }
    if (!USERNAME_RE.test(username.trim())) {
      return NextResponse.json({ error: "Username may only contain letters, numbers, underscores, and hyphens" }, { status: 400 });
    }
  }

  const updates: Record<string, unknown> = {};
  if (approved !== undefined) updates.approved = approved as boolean;
  if (role !== undefined) updates.role = role as "admin" | "user";
  if (password && typeof password === "string") updates.passwordHash = await bcrypt.hash(password, 12);
  if (username && typeof username === "string" && username.trim()) updates.username = username.trim();

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  await db.update(users).set(updates).where(eq(users.id, id));
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  // Prevent deleting yourself
  if (id === auth.userId) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  await db.delete(users).where(eq(users.id, id));
  return NextResponse.json({ success: true });
}
