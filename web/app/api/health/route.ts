import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    // Run a lightweight query to verify the SQLite connection is alive
    await db.run(sql`SELECT 1`);
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Database connection failed" },
      { status: 500 }
    );
  }
}
