#!/usr/bin/env node
/**
 * One-time script: embeds all templates (thumbnail-only) and writes
 * web/data/templates/embeddings.json
 *
 * Run from the web/ directory:
 *   GOOGLE_APPLICATION_CREDENTIALS_JSON='...' node scripts/embed-templates.mjs
 *
 * Safe to re-run — automatically resumes from existing output.
 * Saves after every batch so a crash won't lose work.
 *
 * Estimated cost: ~$0.02 for 10k templates at 256 dims
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import crypto from "crypto";

// ── Config ────────────────────────────────────────────────────────────────────
const BATCH_SIZE = 50;    // instances per Vertex AI request (max 250, 50 is safe)
const DIMS       = 256;   // output dimensionality (256 is accurate and compact)
const MAX_CHARS  = 500;   // truncate content to control cost and stay under token limit
const MODEL      = "text-embedding-004";
const LOCATION   = "us-central1";
const DATA_DIR   = path.join(process.cwd(), "data", "templates");
const OUTPUT     = path.join(DATA_DIR, "embeddings.json");

// ── Credentials ───────────────────────────────────────────────────────────────
const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
if (!credJson) {
  console.error("[embed] ERROR: GOOGLE_APPLICATION_CREDENTIALS_JSON env var not set");
  process.exit(1);
}
const sa = JSON.parse(credJson);
console.log(`[embed] Project: ${sa.project_id}`);
console.log(`[embed] Service account: ${sa.client_email}`);

// ── Auth (same pattern as generate/route.ts) ──────────────────────────────────
function createJWT() {
  const now     = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email, sub: sa.client_email, aud: sa.token_uri,
    iat: now, exp: now + 3600,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  })).toString("base64url");
  const input = `${header}.${payload}`;
  const sign  = crypto.createSign("RSA-SHA256");
  sign.update(input);
  return `${input}.${sign.sign(sa.private_key, "base64url")}`;
}

async function getAccessToken() {
  console.log("[embed] Fetching access token...");
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createJWT(),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Auth failed (${res.status}): ${err.error_description ?? JSON.stringify(err)}`);
  }
  const data = await res.json();
  console.log("[embed] Access token OK");
  return data.access_token;
}

// ── Load templates ────────────────────────────────────────────────────────────
console.log(`[embed] Reading templates from ${DATA_DIR}...`);
const index = JSON.parse(readFileSync(path.join(DATA_DIR, "index.json"), "utf-8"));
const all = [];
for (let i = 0; i < index.chunks; i++) {
  all.push(...JSON.parse(readFileSync(path.join(DATA_DIR, `chunk-${i}.json`), "utf-8")));
}
const templates = all.filter((t) => t.thumbnail !== null);
console.log(`[embed] ${templates.length} templates with thumbnails (${all.length - templates.length} skipped — no thumbnail)`);

// ── Resume support: skip already-embedded IDs ─────────────────────────────────
const done = new Map(); // id -> normalized vector
if (existsSync(OUTPUT)) {
  const existing = JSON.parse(readFileSync(OUTPUT, "utf-8"));
  for (const e of existing) done.set(e.id, e.v);
  console.log(`[embed] Resuming — ${done.size} already embedded, skipping these`);
}
const todo = templates.filter((t) => !done.has(t.id));
console.log(`[embed] To embed: ${todo.length} templates`);

if (todo.length === 0) {
  console.log("[embed] Nothing to do — embeddings.json is already up to date");
  process.exit(0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalize(v) {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return mag === 0 ? v : v.map((x) => x / mag);
}

function formatMs(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Embed ─────────────────────────────────────────────────────────────────────
const accessToken = await getAccessToken();
const apiUrl = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/${LOCATION}/publishers/google/models/${MODEL}:predict`;

const results = [...done.entries()].map(([id, v]) => ({ id, v }));
const totalBatches = Math.ceil(todo.length / BATCH_SIZE);
const scriptStart  = Date.now();

console.log(`\n[embed] Starting — ${totalBatches} batches of up to ${BATCH_SIZE}\n`);

for (let i = 0; i < todo.length; i += BATCH_SIZE) {
  const batch     = todo.slice(i, i + BATCH_SIZE);
  const batchNum  = Math.floor(i / BATCH_SIZE) + 1;
  const elapsed   = formatMs(Date.now() - scriptStart);
  const pct       = Math.round((i / todo.length) * 100);
  const batchStart = Date.now();

  process.stdout.write(`[embed] Batch ${batchNum}/${totalBatches} (${pct}% — ${elapsed} elapsed) ... `);

  const instances = batch.map((t) => ({
    content:   `${t.title}. ${t.description}. ${t.content}`.slice(0, MAX_CHARS),
    task_type: "RETRIEVAL_DOCUMENT",
  }));

  let res, data, attempt = 0;
  while (true) {
    try {
      res  = await fetch(apiUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body:    JSON.stringify({ instances, parameters: { outputDimensionality: DIMS } }),
      });
      data = await res.json();
    } catch (err) {
      console.error(`\n[embed] Network error: ${err.message}`);
      console.error("[embed] Saving partial results...");
      writeFileSync(OUTPUT, JSON.stringify(results));
      process.exit(1);
    }

    if (res.status === 429) {
      attempt++;
      const wait = Math.min(60000, 5000 * attempt);
      process.stdout.write(`rate limited, waiting ${formatMs(wait)}... `);
      await sleep(wait);
      continue;
    }
    break;
  }

  if (!res.ok) {
    console.error(`\n[embed] API error ${res.status}: ${JSON.stringify(data?.error ?? data)}`);
    console.error("[embed] Saving partial results...");
    writeFileSync(OUTPUT, JSON.stringify(results));
    process.exit(1);
  }

  const predictions = data.predictions ?? [];
  if (predictions.length !== batch.length) {
    console.error(`\n[embed] Mismatch: sent ${batch.length}, got ${predictions.length}`);
    writeFileSync(OUTPUT, JSON.stringify(results));
    process.exit(1);
  }

  let missing = 0;
  for (let j = 0; j < batch.length; j++) {
    const values = predictions[j]?.embeddings?.values;
    if (!values) { missing++; continue; }
    results.push({ id: batch[j].id, v: normalize(values) });
  }

  const batchMs = Date.now() - batchStart;
  console.log(`done in ${formatMs(batchMs)}${missing > 0 ? ` (${missing} missing!)` : ""}`);


  // Save after every batch so a crash won't lose progress
  writeFileSync(OUTPUT, JSON.stringify(results));
}

const totalMs = Date.now() - scriptStart;
const fileSizeMB = (readFileSync(OUTPUT).length / 1024 / 1024).toFixed(1);
console.log(`\n[embed] Complete!`);
console.log(`[embed] ${results.length} embeddings in ${formatMs(totalMs)}`);
console.log(`[embed] Output: ${OUTPUT} (${fileSizeMB} MB)`);
