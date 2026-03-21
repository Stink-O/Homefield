import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import fs from "fs";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __hf_db: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

if (!globalThis.__hf_db) {
  const dbPath = path.join(process.cwd(), "..", "storage", "homefield.db");
  // Ensure the storage directory exists before opening the DB file
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });
  // Run all pending migrations on startup — idempotent and safe on every boot
  migrate(db, { migrationsFolder: path.join(process.cwd(), "lib", "db", "migrations") });
  // Backfill column added after initial migration (safe to leave once everyone has migrated)
  const cols = (sqlite.prepare("PRAGMA table_info(images)").all() as { name: string }[]);
  if (!cols.some((c) => c.name === "reference_image_paths")) {
    sqlite.exec("ALTER TABLE images ADD COLUMN reference_image_paths text");
  }
  globalThis.__hf_db = db;
}

export const db = globalThis.__hf_db!;
