#!/usr/bin/env node
/**
 * process-templates.js
 *
 * Parses nano-banana-pro-prompts CSV, categorizes and subcategorizes each
 * prompt, and writes paginated JSON chunks + index to data/templates/.
 *
 * Usage (from web/ directory): node scripts/process-templates.js
 */

const fs = require("fs");
const path = require("path");

const CSV_PATH = path.join(__dirname, "../data/nano-banana-pro-prompts-20260306.csv");
const OUT_DIR = path.join(__dirname, "../data/templates");
const CHUNK_SIZE = 200;

// ---------------------------------------------------------------------------
// Category keyword lists
// ---------------------------------------------------------------------------

const CHARACTER_KEYWORDS = [
  "character", "illustration", "anime", "cartoon", "fantasy", "creature",
  "figure", "warrior", "wizard", "knight", "hero", "villain", "elf",
  "dragon", "monster", "humanoid", "fictional", "concept character",
  "character design", "character sheet",
];

const PORTRAIT_KEYWORDS = [
  "portrait", "selfie", "fashion", "beauty", "face", "editorial",
  "lifestyle", "skin", "hair", "makeup", "swimsuit", "lingerie",
  "clothing", "model", "pose", "headshot", "close-up", "closeup",
  "mirror", "woman", "man", "person", "girl", "boy", "beauty shot",
  "boudoir", "glamour", "photoshoot",
];

const PRODUCT_KEYWORDS = [
  "product", "miniature", "tech-noir", "tech noir", "vintage", "blueprint",
  "3d render", "render", "architecture", "interior", "exterior",
  "vehicle", "car", "food", "logo", "packaging", "mockup",
  "isometric", "flat lay", "still life", "object",
];

const INTERNATIONAL_RE = /[^\x00-\x7F]/;

// ---------------------------------------------------------------------------
// Subcategory rules — ordered, first match wins
// Returns a string key (used as-is in the data)
// ---------------------------------------------------------------------------

const SUBCATEGORY_RULES = {
  portrait: [
    { key: "selfies",    test: (s) => s.includes("selfie") || s.includes("mirror selfie") || s.includes("mirror") },
    { key: "editorial",  test: (s) => s.includes("editorial") },
    { key: "glamour",    test: (s) => s.includes("boudoir") || s.includes("glamour") || s.includes("lingerie") },
    { key: "fashion",    test: (s) => s.includes("fashion") || s.includes("swimsuit") || s.includes("clothing") },
    { key: "headshots",  test: (s) => s.includes("headshot") || s.includes("close-up") || s.includes("closeup") || s.includes("face") },
    { key: "beauty",     test: (s) => s.includes("beauty") || s.includes("makeup") || s.includes("skin") || s.includes("hair") },
    { key: "lifestyle",  test: (s) => s.includes("lifestyle") || s.includes("candid") || s.includes("street") },
  ],
  character: [
    { key: "anime",            test: (s) => s.includes("anime") },
    { key: "cartoon",          test: (s) => s.includes("cartoon") },
    { key: "character-design", test: (s) => s.includes("character design") || s.includes("character sheet") },
    { key: "illustration",     test: (s) => s.includes("illustration") },
    { key: "creature",         test: (s) => s.includes("creature") || s.includes("dragon") || s.includes("monster") },
    { key: "fantasy",          test: (s) => s.includes("fantasy") || s.includes("wizard") || s.includes("elf") },
    { key: "hero-villain",     test: (s) => s.includes("warrior") || s.includes("knight") || s.includes("hero") || s.includes("villain") },
  ],
  product: [
    { key: "food-macro",       test: (s) => s.includes("food") || s.includes("macro") },
    { key: "architecture",     test: (s) => s.includes("architecture") || s.includes("interior") || s.includes("exterior") },
    { key: "miniature",        test: (s) => s.includes("miniature") || s.includes("diorama") },
    { key: "vehicles",         test: (s) => s.includes("vehicle") || s.includes("car") },
    { key: "vintage",          test: (s) => s.includes("vintage") },
    { key: "3d-render",        test: (s) => s.includes("3d render") || s.includes("render") || s.includes("isometric") },
  ],
  general: [
    { key: "cinematic",        test: (s) => s.includes("cinematic") || s.includes("scene") || s.includes("film") },
    { key: "surreal",          test: (s) => s.includes("surreal") || s.includes("dreamlike") || s.includes("abstract") },
    { key: "poster-collage",   test: (s) => s.includes("poster") || s.includes("collage") || s.includes("infographic") || s.includes("grid") },
    { key: "urban-street",     test: (s) => s.includes("urban") || s.includes("street photography") },
    { key: "vintage-aesthetic",test: (s) => s.includes("vintage") || s.includes("golden hour") || s.includes("aesthetic") },
  ],
};

function categorize(title, content) {
  const lower = (title + " " + content.slice(0, 400)).toLowerCase();

  const trimmed = content.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";

  if (INTERNATIONAL_RE.test(title) || INTERNATIONAL_RE.test(content.slice(0, 200))) return "international";

  let characterScore = 0, portraitScore = 0, productScore = 0;
  for (const kw of CHARACTER_KEYWORDS) if (lower.includes(kw)) characterScore++;
  for (const kw of PORTRAIT_KEYWORDS)  if (lower.includes(kw)) portraitScore++;
  for (const kw of PRODUCT_KEYWORDS)   if (lower.includes(kw)) productScore++;

  if (characterScore > 0 && characterScore >= portraitScore && characterScore >= productScore) return "character";
  if (portraitScore > 0 && portraitScore >= productScore) return "portrait";
  if (productScore > 0) return "product";
  return "general";
}

function getSubcategory(category, lower) {
  const rules = SUBCATEGORY_RULES[category];
  if (!rules) return null; // json, international have no subcategories
  for (const rule of rules) {
    if (rule.test(lower)) return rule.key;
  }
  return "other";
}

// ---------------------------------------------------------------------------
// CSV parser — character-by-character state machine
// ---------------------------------------------------------------------------

function parseCSV(text) {
  const rows = [];
  let inQuote = false;
  let field = "";
  let row = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; }
        else { inQuote = false; i++; }
      } else { field += ch; i++; }
    } else {
      if (ch === '"') { inQuote = true; i++; }
      else if (ch === ",") { row.push(field); field = ""; i++; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 0) rows.push(row);
        row = []; i++;
      } else { field += ch; i++; }
    }
  }
  if (field || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function extractAuthorName(authorStr) {
  try { const obj = JSON.parse(authorStr); return obj.name || obj.link || authorStr; }
  catch { return authorStr || "Unknown"; }
}

function extractFirstMedia(mediaStr) {
  if (!mediaStr) return null;
  try { const arr = JSON.parse(mediaStr); if (Array.isArray(arr) && arr.length > 0) return arr[0]; }
  catch {}
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log("Reading CSV...");
  const t0 = Date.now();
  const text = fs.readFileSync(CSV_PATH, "utf8");
  console.log(`Read ${(text.length / 1024 / 1024).toFixed(1)} MB in ${Date.now() - t0}ms`);

  console.log("Parsing CSV...");
  const t1 = Date.now();
  const rows = parseCSV(text);
  console.log(`Parsed ${rows.length} rows in ${Date.now() - t1}ms`);

  const header = rows[0];
  const idIdx      = header.indexOf("id");
  const titleIdx   = header.indexOf("title");
  const descIdx    = header.indexOf("description");
  const contentIdx = header.indexOf("content");
  const authorIdx  = header.indexOf("author");
  const mediaIdx   = header.indexOf("sourceMedia");

  if (idIdx < 0 || contentIdx < 0) {
    console.error("ERROR: Missing required columns:", header);
    process.exit(1);
  }

  const categoryCounts = { json: 0, portrait: 0, product: 0, character: 0, international: 0, general: 0 };
  // subcategoryCounts: { [category]: { [subcategory]: count } }
  const subcategoryCounts = {};

  let skipped = 0, chunkIndex = 0, totalRecords = 0;
  let chunkBuffer = [];

  function flushChunk() {
    if (!chunkBuffer.length) return;
    fs.writeFileSync(path.join(OUT_DIR, `chunk-${chunkIndex}.json`), JSON.stringify(chunkBuffer));
    process.stdout.write(`\r  Wrote chunk-${chunkIndex}.json (${chunkBuffer.length} records)`);
    chunkIndex++;
    chunkBuffer = [];
  }

  console.log("Processing records...");
  const t2 = Date.now();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const minCols = Math.max(idIdx, titleIdx, descIdx, contentIdx, authorIdx, mediaIdx) + 1;
    if (row.length < minCols) { skipped++; continue; }

    const id          = row[idIdx]?.trim();
    const title       = (row[titleIdx]   || "").trim();
    const description = (row[descIdx]    || "").trim();
    const content     = (row[contentIdx] || "").trim();
    const authorRaw   = (row[authorIdx]  || "").trim();
    const mediaRaw    = (row[mediaIdx]   || "").trim();

    if (!content || content.length < 10) { skipped++; continue; }

    const lower       = (title + " " + content.slice(0, 400)).toLowerCase();
    const category    = categorize(title, content);
    const subcategory = getSubcategory(category, lower);
    const author      = extractAuthorName(authorRaw);
    const thumbnail   = extractFirstMedia(mediaRaw);

    categoryCounts[category]++;
    if (subcategory) {
      if (!subcategoryCounts[category]) subcategoryCounts[category] = {};
      subcategoryCounts[category][subcategory] = (subcategoryCounts[category][subcategory] || 0) + 1;
    }
    totalRecords++;

    chunkBuffer.push({ id, title: title || "Untitled Prompt", description: description.slice(0, 300), content, author, thumbnail, category, subcategory });

    if (chunkBuffer.length >= CHUNK_SIZE) flushChunk();
  }

  flushChunk();
  console.log(`\nProcessed ${totalRecords} records, skipped ${skipped} in ${Date.now() - t2}ms`);
  console.log("Category breakdown:", categoryCounts);
  console.log("Subcategory breakdown:");
  for (const [cat, subs] of Object.entries(subcategoryCounts)) {
    console.log(`  ${cat}:`, subs);
  }

  const index = { totalRecords, chunks: chunkIndex, chunkSize: CHUNK_SIZE, categoryCounts, subcategoryCounts };
  fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(index, null, 2));
  console.log(`\nWrote index.json — ${chunkIndex} chunks in ${OUT_DIR}`);
}

main();
