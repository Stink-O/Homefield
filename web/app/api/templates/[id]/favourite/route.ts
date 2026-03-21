import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { templateFavourites } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id: templateId } = await params;

  const favourited = await db.transaction(async (tx) => {
    const existing = await tx.query.templateFavourites.findFirst({
      where: and(
        eq(templateFavourites.userId, auth.userId),
        eq(templateFavourites.templateId, templateId)
      ),
    });

    if (existing) {
      await tx.delete(templateFavourites).where(
        and(
          eq(templateFavourites.userId, auth.userId),
          eq(templateFavourites.templateId, templateId)
        )
      );
      return false;
    } else {
      await tx.insert(templateFavourites).values({
        userId: auth.userId,
        templateId,
        createdAt: Date.now(),
      });
      return true;
    }
  });

  return NextResponse.json({ favourited });
}
