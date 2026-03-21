import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { templates, templateFavourites } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";
import { deleteTemplateThumb } from "@/lib/fileStorage";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  const template = await db.query.templates.findFirst({
    where: and(eq(templates.id, id), eq(templates.userId, auth.userId)),
  });
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (template.thumbnailPath) {
    await deleteTemplateThumb(template.thumbnailPath);
  }

  await db.delete(templates).where(eq(templates.id, id));
  return NextResponse.json({ success: true });
}
