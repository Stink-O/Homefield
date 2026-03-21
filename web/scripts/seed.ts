import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import * as schema from "../lib/db/schema";

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};

const username = getArg("--username") ?? "admin";
const password = getArg("--password");

if (!password) {
  console.error("Usage: npx tsx scripts/seed.ts --username admin --password <password>");
  process.exit(1);
}

const dbPath = path.join(process.cwd(), "..", "storage", "homefield.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
const db = drizzle(sqlite, { schema });

async function main() {
  const passwordHash = await bcrypt.hash(password!, 12);
  const id = crypto.randomUUID();

  await db.insert(schema.users).values({
    id,
    username,
    email: null,
    passwordHash,
    role: "admin",
    approved: true,
    createdAt: Date.now(),
  });

  console.log(`Created admin user: ${username} (id: ${id})`);
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
