import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

export const dynamic = "force-dynamic";

interface TemplatePrompt {
  id: string;
  title: string;
  description: string;
  content: string;
  author: string;
  thumbnail: string | null;
  category: "json" | "portrait" | "product" | "character" | "international" | "general";
  subcategory: string | null;
}

interface IndexFile {
  totalRecords: number;
  chunks: number;
  chunkSize: number;
  categoryCounts: Record<string, number>;
  subcategoryCounts: Record<string, Record<string, number>>;
}

interface Cache {
  prompts: TemplatePrompt[];
  categoryCounts: Record<string, number>;
  subcategoryCounts: Record<string, Record<string, number>>;
}

let cache: Cache | null = null;

const PAGE_SIZE = 24;
const DATA_DIR = path.join(process.cwd(), "data", "templates");

async function loadCache(): Promise<Cache> {
  if (cache) return cache;

  const indexRaw = await fs.readFile(path.join(DATA_DIR, "index.json"), "utf-8");
  const index: IndexFile = JSON.parse(indexRaw);

  const chunks = await Promise.all(
    Array.from({ length: index.chunks }, (_, i) =>
      fs.readFile(path.join(DATA_DIR, `chunk-${i}.json`), "utf-8").then(
        (raw) => JSON.parse(raw) as TemplatePrompt[]
      )
    )
  );

  cache = {
    prompts: chunks.flat(),
    categoryCounts: index.categoryCounts,
    subcategoryCounts: index.subcategoryCounts ?? {},
  };
  return cache;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const page        = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10) || 0);
    const category    = searchParams.get("category") ?? "all";
    const subcategory = searchParams.get("subcategory") ?? "all";
    const search      = (searchParams.get("search") ?? "").trim().toLowerCase();

    const { prompts, categoryCounts, subcategoryCounts } = await loadCache();

    let filtered = category === "all" ? prompts : prompts.filter((p) => p.category === category);

    if (subcategory !== "all") {
      filtered = filtered.filter((p) => p.subcategory === subcategory);
    }

    if (search) {
      type Scored = { p: TemplatePrompt; score: number };
      const scored: Scored[] = filtered.reduce<Scored[]>((acc, p) => {
        const title  = p.title.toLowerCase();
        const desc   = p.description.toLowerCase();
        const author = p.author.toLowerCase();
        const content = p.content.toLowerCase();
        let score = 0;
        if (title.includes(search))   score += 3;
        if (desc.includes(search))    score += 2;
        if (author.includes(search))  score += 1;
        if (content.includes(search)) score += 1;
        if (score > 0) acc.push({ p, score });
        return acc;
      }, []);
      scored.sort((a, b) => b.score - a.score);
      filtered = scored.map((s) => s.p);
    }

    const total = filtered.length;
    const start = page * PAGE_SIZE;

    return NextResponse.json({
      prompts: filtered.slice(start, start + PAGE_SIZE),
      total,
      page,
      pageSize: PAGE_SIZE,
      hasMore: start + PAGE_SIZE < total,
      categoryCounts,
      // Return subcategory counts for the active category (or empty)
      subcategoryCounts: category !== "all" ? (subcategoryCounts[category] ?? {}) : {},
    });
  } catch (err) {
    console.error("[/api/templates] Error:", err);
    return NextResponse.json({ error: "Failed to load templates" }, { status: 500 });
  }
}
