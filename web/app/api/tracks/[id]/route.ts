import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/authHelpers";
import { db } from "@/lib/db";
import { tracks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { deleteAudioFile } from "@/lib/fileStorage";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  const [track] = await db
    .select()
    .from(tracks)
    .where(and(eq(tracks.id, id), eq(tracks.userId, auth.userId)));

  if (!track) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await deleteAudioFile(track.filePath);
  await db.delete(tracks).where(eq(tracks.id, id));

  return NextResponse.json({ ok: true });
}
