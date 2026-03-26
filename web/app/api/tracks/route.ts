import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/authHelpers";
import { db } from "@/lib/db";
import { tracks } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const rows = await db
    .select()
    .from(tracks)
    .where(eq(tracks.userId, auth.userId))
    .orderBy(desc(tracks.timestamp))
    .limit(100);

  return NextResponse.json({ tracks: rows });
}
