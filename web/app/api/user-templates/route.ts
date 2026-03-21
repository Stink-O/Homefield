import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { templates } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";
import { saveTemplateThumb, deleteTemplateThumb } from "@/lib/fileStorage";
import crypto from "crypto";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const results = await db.select().from(templates)
    .where(eq(templates.userId, auth.userId))
    .orderBy(desc(templates.createdAt));

  return NextResponse.json(results.map((t) => ({
    ...t,
    thumbnailUrl: t.thumbnailPath ? `/api/files/${t.thumbnailPath}` : null,
  })));
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json() as {
    title: string;
    description?: string;
    content: string;
    thumbnailBase64?: string;
    thumbnailMimeType?: string;
  };

  if (!body.title?.trim() || !body.content?.trim()) {
    return NextResponse.json({ error: "Title and content required" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  let thumbnailPath: string | null = null;

  if (body.thumbnailBase64 && body.thumbnailMimeType) {
    thumbnailPath = await saveTemplateThumb(auth.userId, id, body.thumbnailBase64, body.thumbnailMimeType);
  }

  const template = {
    id,
    userId: auth.userId,
    title: body.title.trim(),
    description: body.description?.trim() ?? "",
    content: body.content,
    thumbnailPath,
    createdAt: Date.now(),
  };

  await db.insert(templates).values(template);
  return NextResponse.json({
    ...template,
    thumbnailUrl: thumbnailPath ? `/api/files/${thumbnailPath}` : null,
  }, { status: 201 });
}
