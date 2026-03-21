import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import crypto from "crypto";
import { requireAuth } from "@/lib/authHelpers";

export const dynamic = "force-dynamic";

// ── DEBUG: flip to false once working, then remove all // DEBUG lines ──────────
const DEBUG = process.env.FOR_YOU_DEBUG === "1";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ServiceAccount {
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

interface TemplatePrompt {
  id: string;
  title: string;
  description: string;
  content: string;
  author: string;
  thumbnail: string | null;
  category: string;
  subcategory: string | null;
}

interface IndexFile {
  chunks: number;
}

// ── Auth (same as generate/route.ts) ─────────────────────────────────────────
function createJWT(sa: ServiceAccount): string {
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

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 5 * 60 * 1000) return cachedToken.value;
  const jwt = createJWT(sa);
  const res = await fetch(sa.token_uri, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Auth failed: ${(err as Record<string, string>).error_description ?? res.status}`);
  }
  const data = await res.json() as { access_token: string; expires_in?: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

// ── In-memory cache ───────────────────────────────────────────────────────────
let embeddingCache: Map<string, number[]> | null = null;
let templateCache:  Map<string, TemplatePrompt>  | null = null;

const DATA_DIR = path.join(process.cwd(), "data", "templates");

async function loadCaches(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (embeddingCache && templateCache) return { ok: true };

  const embPath = path.join(DATA_DIR, "embeddings.json");
  if (!existsSync(embPath)) {
    return { ok: false, reason: "embeddings.json not found — run scripts/embed-templates.mjs first" };
  }

  const t0 = Date.now();
  const [embRaw, indexRaw] = await Promise.all([
    fs.readFile(embPath, "utf-8"),
    fs.readFile(path.join(DATA_DIR, "index.json"), "utf-8"),
  ]);

  const embeddings: { id: string; v: number[] }[] = JSON.parse(embRaw);
  embeddingCache = new Map(embeddings.map((e) => [e.id, e.v]));

  const index: IndexFile = JSON.parse(indexRaw);
  const chunks = await Promise.all(
    Array.from({ length: index.chunks }, (_, i) =>
      fs.readFile(path.join(DATA_DIR, `chunk-${i}.json`), "utf-8").then(
        (raw) => JSON.parse(raw) as TemplatePrompt[]
      )
    )
  );
  templateCache = new Map(
    chunks.flat()
      .filter((t) => !!t.thumbnail)
      .map((t) => [t.id, t])
  );

  console.log(
    `[ForYou] Cache loaded — ${embeddingCache.size} embeddings, ` +
    `${templateCache.size} templates (${Date.now() - t0}ms)`
  );
  return { ok: true };
}

// ── Maths ─────────────────────────────────────────────────────────────────────
function normalize(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return mag === 0 ? v : v.map((x) => x / mag);
}

// Pre-normalized vectors: cosine sim = dot product
function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ── Vertex AI embedding call ──────────────────────────────────────────────────
const DIMS = 256; // must match what embed-templates.mjs used

async function embedTexts(sa: ServiceAccount, accessToken: string, texts: string[]): Promise<number[][]> {
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/us-central1/publishers/google/models/text-embedding-004:predict`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body:    JSON.stringify({
      instances:  texts.map((t) => ({ content: t, task_type: "RETRIEVAL_QUERY" })),
      parameters: { outputDimensionality: DIMS },
    }),
  });
  const data = await res.json() as {
    predictions?: { embeddings: { values: number[] } }[];
    error?: { message: string };
  };
  if (!res.ok) throw new Error(`Embedding API ${res.status}: ${data.error?.message ?? JSON.stringify(data)}`);
  return (data.predictions ?? []).map((p) => p.embeddings.values);
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const isDebug = req.nextUrl.searchParams.has("debug"); // DEBUG
  const debugInfo: Record<string, unknown> = {};          // DEBUG

  let body: { prompts?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const prompts = (body.prompts ?? []).filter(Boolean).slice(0, 20);
  if (!prompts.length) return NextResponse.json({ error: "prompts required" }, { status: 400 });

  const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credJson) return NextResponse.json({ error: "Server credentials not configured" }, { status: 500 });

  const sa: ServiceAccount = JSON.parse(credJson);

  // Load caches
  const cacheResult = await loadCaches();
  if (!cacheResult.ok) {
    console.error(`[ForYou] ${cacheResult.reason}`);
    return NextResponse.json({ error: cacheResult.reason }, { status: 503 });
  }

  // Embed user prompts
  const t0 = Date.now();
  if (DEBUG) console.log(`[ForYou] Embedding ${prompts.length} prompts: ${prompts.map((p) => `"${p.slice(0, 40)}"`).join(", ")}`); // DEBUG
  let vectors: number[][];
  try {
    const accessToken = await getAccessToken(sa);
    vectors = await embedTexts(sa, accessToken, prompts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ForYou] Embedding failed: ${msg}`);
    return NextResponse.json({ error: `Embedding failed: ${msg}` }, { status: 500 });
  }
  const embedMs = Date.now() - t0; // DEBUG
  if (DEBUG) { debugInfo.embedMs = embedMs; debugInfo.promptCount = prompts.length; } // DEBUG

  // Average query vectors into one representative vector
  const dims = vectors[0].length;
  const avgVector = normalize(
    vectors.reduce((acc, v) => acc.map((x, i) => x + v[i]), new Array(dims).fill(0) as number[])
  );

  // Score all templates
  const t1 = Date.now(); // DEBUG
  const scored: { id: string; score: number }[] = [];
  for (const [id, v] of embeddingCache!) {
    scored.push({ id, score: dot(avgVector, v) });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 100);
  const scoreMs = Date.now() - t1; // DEBUG

  if (DEBUG) { // DEBUG
    debugInfo.scoreMs = scoreMs; // DEBUG
    debugInfo.totalTemplates = embeddingCache!.size; // DEBUG
    debugInfo.topScores = top.slice(0, 10).map((s) => ({ // DEBUG
      id: s.id, score: +s.score.toFixed(4), title: templateCache!.get(s.id)?.title, // DEBUG
    })); // DEBUG
    console.log(`[ForYou] embed=${embedMs}ms score=${scoreMs}ms top-3:`, debugInfo.topScores); // DEBUG
  } // DEBUG

  // Hydrate with full template data
  const results = top.map((s) => templateCache!.get(s.id)).filter(Boolean) as TemplatePrompt[];

  console.log(`[ForYou] ${prompts.length} prompts → ${results.length} suggestions (embed=${embedMs}ms score=${scoreMs}ms)`);

  return NextResponse.json({
    prompts: results,
    ...(isDebug ? { debugInfo } : {}), // DEBUG
  });
}
