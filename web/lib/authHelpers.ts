import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function requireAuth(): Promise<{ userId: string; role: string } | NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return {
    userId: session.user.id,
    role: (session.user as { id: string; role: string }).role,
  };
}

export async function requireAdmin(): Promise<{ userId: string; role: string } | NextResponse> {
  const result = await requireAuth();
  if (result instanceof NextResponse) return result;
  if (result.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return result;
}
