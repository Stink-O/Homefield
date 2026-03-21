import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/authHelpers";

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const pending = await db.select({ id: users.id })
    .from(users)
    .where(eq(users.approved, false));

  return NextResponse.json({ count: pending.length });
}
