import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/authHelpers";
import { getSharedPending } from "@/lib/sharedPending";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json(getSharedPending());
}
