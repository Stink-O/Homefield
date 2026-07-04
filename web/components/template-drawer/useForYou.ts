"use client";

import { useCallback, useEffect, useState } from "react";
import type { TemplatePrompt } from "./constants";
import {
  forYouIsLimited,
  forYouGetCache,
  forYouSetCache,
  forYouRecordFetch,
  forYouMarkSeen,
  forYouFilterUnseen,
} from "./forYouStorage";

// DEBUG: set to false once working, then remove all FOR_YOU_DEBUG blocks
const FOR_YOU_DEBUG = true;

// For You recommendations: fetched once per drawer session (results persist
// across opens — refresh() forces a re-fetch), rate limited via localStorage.
export function useForYou(open: boolean, active: boolean) {
  const [forYouResults,  setForYouResults]  = useState<TemplatePrompt[]>([]);
  const [forYouLoading,  setForYouLoading]  = useState(false);
  const [forYouError,    setForYouError]    = useState<string | null>(null);
  const [forYouFetched,  setForYouFetched]  = useState(false);

  useEffect(() => {
    if (!open || !active || forYouFetched) return;

    async function fetchForYou() {
      setForYouLoading(true);
      setForYouError(null);

      // Rate limited — serve cached results silently
      if (forYouIsLimited()) {
        const cached = forYouGetCache();
        if (FOR_YOU_DEBUG) console.log("[ForYou] Rate limited — serving cache:", cached.length); // DEBUG
        if (cached.length > 0) {
          await new Promise((r) => setTimeout(r, 600)); // brief fake load
          setForYouResults(cached);
          setForYouFetched(true);
          setForYouLoading(false);
          return;
        }
        // No cache yet — fall through to real fetch
      }

      try {
        const historyRes = await fetch("/api/images?workspaceId=all&limit=100");
        const historyData = historyRes.ok ? await historyRes.json() : { items: [] };
        const sorted = (historyData.items as { prompt: string; timestamp: number }[])
          .sort((a, b) => b.timestamp - a.timestamp)
          .map((item) => item.prompt)
          .filter(Boolean);

        const recent = sorted.slice(0, 5);
        const remaining = sorted.slice(5);
        const shuffled = remaining.sort(() => Math.random() - 0.5).slice(0, 15);
        const recentPrompts = [...new Set([...recent, ...shuffled])];

        if (FOR_YOU_DEBUG) console.log("[ForYou] Sending prompts:", recentPrompts); // DEBUG

        if (recentPrompts.length < 3) {
          setForYouError("not-enough");
          return;
        }

        const debugParam = FOR_YOU_DEBUG ? "?debug=1" : ""; // DEBUG
        const res = await fetch(`/api/for-you${debugParam}`, { // DEBUG
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ prompts: recentPrompts }),
        });
        const data = await res.json();

        if (FOR_YOU_DEBUG) console.log("[ForYou] Response:", data); // DEBUG

        if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
        const results = data.prompts ?? [];
        const filtered = forYouFilterUnseen(results);
        forYouSetCache(filtered);
        forYouRecordFetch();
        forYouMarkSeen(filtered.map((p: TemplatePrompt) => p.id));
        setForYouResults(filtered);
        setForYouFetched(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[ForYou] Error:", msg);
        // Fall back to cache on error
        const cached = forYouGetCache();
        if (cached.length > 0) {
          setForYouResults(cached);
          setForYouFetched(true);
        } else {
          setForYouError(msg);
        }
      } finally {
        setForYouLoading(false);
      }
    }

    fetchForYou();
  }, [open, active, forYouFetched]);

  // Refresh button: clear everything so the effect re-fetches from scratch.
  const refresh = useCallback(() => {
    setForYouFetched(false);
    setForYouError(null);
    setForYouResults([]);
  }, []);

  // Retry after an error: keep current results, just re-run the fetch.
  const retry = useCallback(() => {
    setForYouFetched(false);
    setForYouError(null);
  }, []);

  return { forYouResults, forYouLoading, forYouError, refresh, retry };
}
