import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";
import crypto from "crypto";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const results = await db.select().from(workspaces)
    .where(eq(workspaces.userId, auth.userId))
    .orderBy(workspaces.createdAt);

  return NextResponse.json(results);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { name } = await req.json() as { name: string };
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const workspace = {
    id: crypto.randomUUID(),
    userId: auth.userId,
    name: name.trim(),
    createdAt: Date.now(),
  };

  await db.insert(workspaces).values(workspace);
  return NextResponse.json(workspace, { status: 201 });
}
