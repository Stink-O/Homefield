import type { TemplatePrompt } from "./constants";

// ── For You rate limiting (3 real fetches per 10 min, cached results otherwise) ──
// Module scope: these only touch localStorage, so they never appear on a React
// effect's dependency list.
const FOR_YOU_RATE_LIMIT  = 3;
const FOR_YOU_WINDOW_MS   = 10 * 60 * 1000;

function forYouGetTimes(): number[] {
  try { return JSON.parse(localStorage.getItem("fy-times") ?? "[]"); } catch { return []; }
}
export function forYouIsLimited(): boolean {
  const now = Date.now();
  return forYouGetTimes().filter((t) => now - t < FOR_YOU_WINDOW_MS).length >= FOR_YOU_RATE_LIMIT;
}
export function forYouRecordFetch() {
  const now = Date.now();
  const times = forYouGetTimes().filter((t) => now - t < FOR_YOU_WINDOW_MS);
  times.push(now);
  localStorage.setItem("fy-times", JSON.stringify(times));
}
export function forYouGetCache(): TemplatePrompt[] {
  try { return JSON.parse(localStorage.getItem("fy-cache") ?? "[]"); } catch { return []; }
}
export function forYouSetCache(results: TemplatePrompt[]) {
  try { localStorage.setItem("fy-cache", JSON.stringify(results)); } catch {}
}

// ── For You seen-template exclusion (7-day cooldown per template) ──
const FOR_YOU_SEEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
function forYouGetSeen(): { id: string; seenAt: number }[] {
  try { return JSON.parse(localStorage.getItem("fy-seen") ?? "[]"); } catch { return []; }
}
export function forYouMarkSeen(ids: string[]) {
  const now = Date.now();
  const existing = forYouGetSeen().filter((e) => now - e.seenAt < FOR_YOU_SEEN_TTL && !ids.includes(e.id));
  const next = [...existing, ...ids.map((id) => ({ id, seenAt: now }))];
  try { localStorage.setItem("fy-seen", JSON.stringify(next.slice(-500))); } catch {}
}
export function forYouFilterUnseen(results: TemplatePrompt[]): TemplatePrompt[] {
  const now = Date.now();
  const seenIds = new Set(forYouGetSeen().filter((e) => now - e.seenAt < FOR_YOU_SEEN_TTL).map((e) => e.id));
  const unseen = results.filter((p) => !seenIds.has(p.id));
  // If filtering leaves fewer than 6, relax and return all (avoids empty grid)
  return unseen.length >= 6 ? unseen : results;
}
