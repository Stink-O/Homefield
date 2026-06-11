import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { requireAuth } from "@/lib/authHelpers";
import { checkRateLimit } from "@/lib/rateLimit";
import { ServiceAccount, parseServiceAccount, getAccessToken } from "@/lib/vertexAuth";

export const dynamic = "force-dynamic";

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

function normalize(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return mag === 0 ? v : v.map((x) => x / mag);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

const DIMS = 256;

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

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const rl = checkRateLimit(`for-you:${auth.userId}`, 60, 10 * 60 * 1000);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
    return NextResponse.json(
      { error: "Rate limit reached" },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  let body: { prompts?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const prompts = (body.prompts ?? []).filter(Boolean).slice(0, 20);
  if (!prompts.length) return NextResponse.json({ error: "prompts required" }, { status: 400 });

  const credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credJson) return NextResponse.json({ error: "Server credentials not configured" }, { status: 500 });

  let sa: ServiceAccount;
  try {
    sa = parseServiceAccount(credJson);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid credentials";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const cacheResult = await loadCaches();
  if (!cacheResult.ok) {
    console.error(`[ForYou] ${cacheResult.reason}`);
    return NextResponse.json({ error: cacheResult.reason }, { status: 503 });
  }

  const t0 = Date.now();
  let vectors: number[][];
  try {
    const accessToken = await getAccessToken(sa);
    vectors = await embedTexts(sa, accessToken, prompts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ForYou] Embedding failed: ${msg}`);
    return NextResponse.json({ error: `Embedding failed: ${msg}` }, { status: 500 });
  }
  const embedMs = Date.now() - t0;

  const dims = vectors[0].length;
  const avgVector = normalize(
    vectors.reduce((acc, v) => acc.map((x, i) => x + v[i]), new Array(dims).fill(0) as number[])
  );

  const t1 = Date.now();
  const scored: { id: string; score: number }[] = [];
  for (const [id, v] of embeddingCache!) {
    scored.push({ id, score: dot(avgVector, v) });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 100);
  const scoreMs = Date.now() - t1;

  const results = top.map((s) => templateCache!.get(s.id)).filter(Boolean) as TemplatePrompt[];

  console.log(`[ForYou] ${prompts.length} prompts → ${results.length} suggestions (embed=${embedMs}ms score=${scoreMs}ms)`);

  return NextResponse.json({ prompts: results });
}
