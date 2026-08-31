"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CredentialAccess, CredentialSourceKind } from "@/lib/agent/contract";
import { DEFAULT_TIER } from "./tiers";

/**
 * The signed-in user's own credential status, from /api/credentials.
 *
 * That route never returns key material — only the tier an admin set, whether a
 * key is on file, and the identity of that key. Nothing here writes the tier:
 * only PATCH /api/admin/credentials can, and only for an admin.
 */
export interface OwnCredentialStatus {
  access: CredentialAccess;
  hasOwnKey: boolean;
  clientEmail: string | null;
  projectId: string | null;
  updatedAt: number | null;
  source: CredentialSourceKind;
  canGenerate: boolean;
}

const ENDPOINT = "/api/credentials";

function normalize(raw: unknown): OwnCredentialStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const access = r.access === "own" || r.access === "shared" || r.access === "none" ? r.access : DEFAULT_TIER;
  const source =
    r.source === "user" || r.source === "instance" || r.source === "env" || r.source === "none"
      ? r.source
      : "none";
  return {
    access,
    hasOwnKey: r.hasOwnKey === true,
    clientEmail: typeof r.clientEmail === "string" ? r.clientEmail : null,
    projectId: typeof r.projectId === "string" ? r.projectId : null,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : null,
    source,
    canGenerate: r.canGenerate === true,
  };
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) return null;
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

export interface MutationResult {
  ok: boolean;
  error?: string;
}

/**
 * Reads and mutates the current user's own key. `enabled` lets a modal skip the
 * request until it is actually open.
 *
 * Every request resolves rather than throws, and each setState happens in a
 * callback rather than in the effect body.
 */
export function useOwnCredentials(enabled = true) {
  const [status, setStatus] = useState<OwnCredentialStatus | null>(null);
  // `settled` rather than a loading flag flipped from an effect: a modal that
  // re-enables the hook must show its first request as loading without any
  // setState in the effect body.
  const [settled, setSettled] = useState(false);
  const [busy, setBusy] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (!enabled) return;
    void fetch(ENDPOINT, { cache: "no-store" })
      .then(async (res) => (res.ok ? normalize(await readJson(res)) : null))
      .catch(() => null)
      .then((next) => {
        if (!aliveRef.current) return;
        setSettled(true);
        if (next) setStatus(next);
      });
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const apply = useCallback(async (init: RequestInit, fallback: string): Promise<MutationResult> => {
    setBusy(true);
    try {
      const res = await fetch(ENDPOINT, init);
      const body = await readJson(res);
      if (!res.ok) {
        const message = body && typeof body.error === "string" ? body.error : fallback;
        return { ok: false, error: message };
      }
      const next = normalize(body);
      if (next && aliveRef.current) setStatus(next);
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not reach the server. Check your connection." };
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, []);

  const saveKey = useCallback(
    (json: string) =>
      apply(
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ json }),
        },
        "Could not save the key.",
      ),
    [apply],
  );

  const clearKey = useCallback(
    () => apply({ method: "DELETE" }, "Could not remove the key."),
    [apply],
  );

  return { status, loading: enabled && !settled, busy, refresh, saveKey, clearKey };
}
