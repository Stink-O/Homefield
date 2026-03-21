import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/authHelpers";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const user = await db.query.users.findFirst({
    where: eq(users.id, auth.userId),
    columns: { id: true, username: true, email: true, role: true, approved: true },
  });

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json(user);
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { username, currentPassword, newPassword } = await req.json() as {
    username?: string;
    currentPassword?: string;
    newPassword?: string;
  };

  const user = await db.query.users.findFirst({ where: eq(users.id, auth.userId) });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const updates: Partial<typeof users.$inferInsert> = {};

  if (username !== undefined) {
    const trimmed = username.trim();
    if (trimmed.length < 2) return NextResponse.json({ error: "Username must be at least 2 characters" }, { status: 400 });
    // Check uniqueness
    const existing = await db.query.users.findFirst({ where: eq(users.username, trimmed) });
    if (existing && existing.id !== auth.userId) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }
    updates.username = trimmed;
  }

  if (newPassword !== undefined) {
    if (!currentPassword) return NextResponse.json({ error: "Current password required" }, { status: 400 });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    if (newPassword.length < 6) return NextResponse.json({ error: "New password must be at least 6 characters" }, { status: 400 });
    updates.passwordHash = await bcrypt.hash(newPassword, 12);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  await db.update(users).set(updates).where(eq(users.id, auth.userId));
  return NextResponse.json({ success: true, username: updates.username ?? user.username });
}
