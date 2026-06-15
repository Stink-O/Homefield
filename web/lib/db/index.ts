import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import fs from "fs";
import * as schema from "./schema";

declare global {
   
  var __hf_db: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

if (!globalThis.__hf_db) {
  const dbPath = path.join(process.cwd(), "..", "storage", "homefield.db");
  // Ensure the storage directory exists before opening the DB file
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  // Wait instead of failing if another connection holds a write lock
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });

  // Skip schema setup during `next build`. Page-data collection spawns several
  // worker processes that each import this module; running migrate() in all of
  // them races to create the same tables ("table images already exists") and
  // fails the build. The DB is only used at request time, so migrations run at
  // server startup instead, where there is a single process.
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    // Run all pending migrations on startup — idempotent and safe on every boot
    migrate(db, { migrationsFolder: path.join(process.cwd(), "lib", "db", "migrations") });
    // Backfill columns added after initial migrations (safe no-ops once applied)
    const imageCols = (sqlite.prepare("PRAGMA table_info(images)").all() as { name: string }[]);
    if (!imageCols.some((c) => c.name === "reference_image_paths")) {
      sqlite.exec("ALTER TABLE images ADD COLUMN reference_image_paths text");
    }
    const trackCols = (sqlite.prepare("PRAGMA table_info(tracks)").all() as { name: string }[]);
    if (!trackCols.some((c) => c.name === "lyrics")) {
      sqlite.exec("ALTER TABLE tracks ADD COLUMN lyrics text");
    }
    if (!trackCols.some((c) => c.name === "description")) {
      sqlite.exec("ALTER TABLE tracks ADD COLUMN description text");
    }
  }
  globalThis.__hf_db = db;
}

export const db = globalThis.__hf_db!;
