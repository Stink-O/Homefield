import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";

const username = process.argv[2] ?? "admin";
const password = process.argv[3];

if (!password) {
  console.error("Usage: npx tsx scripts/reset-password.ts <username> <newpassword>");
  process.exit(1);
}

const dbPath = path.join(process.cwd(), "..", "storage", "homefield.db");
const db = new Database(dbPath);
const hash = bcrypt.hashSync(password, 12);
const result = db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").run(hash, username);

if (result.changes === 0) {
  console.error(`No user found with username: ${username}`);
} else {
  console.log(`Password updated for: ${username}`);
}
db.close();
