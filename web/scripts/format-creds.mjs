#!/usr/bin/env node
/**
 * Usage: node scripts/format-creds.mjs /path/to/service-account-key.json
 *
 * Reads a Google service account JSON key file, minifies it, and prints the
 * ready-to-paste line for .env.local.
 */

import { readFileSync } from "fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/format-creds.mjs <path-to-key.json>");
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(readFileSync(file, "utf8"));
} catch {
  console.error("Could not read or parse the file. Make sure it is a valid JSON key file.");
  process.exit(1);
}

const minified = JSON.stringify(parsed);
console.log(`\nCopy the line below into your .env.local:\n`);
console.log(`GOOGLE_APPLICATION_CREDENTIALS_JSON='${minified}'`);
