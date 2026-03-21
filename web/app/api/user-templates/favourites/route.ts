import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { templateFavourites } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/authHelpers";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const favs = await db.select({ templateId: templateFavourites.templateId })
    .from(templateFavourites)
    .where(eq(templateFavourites.userId, auth.userId));

  return NextResponse.json(favs.map((f) => f.templateId));
}
