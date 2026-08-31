"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ALL_AGENT_SCOPES, type AgentScope, type DestinationMode } from "@/lib/agent/contract";
import type { ModelId, Quality } from "@/lib/types";
import type { AgentKeySummary, CreateAgentKeyRequest } from "./types";

/**
 * "checking" — the first request is in flight.
 * "ready"    — the route answered with JSON.
 * "missing"  — the route is not on this instance yet (404, 501, or HTML back
 *              from the Next.js not-found page). The UI stays usable and says so.
 * "error"    — the route exists but failed, or the network did.
 */
export type AgentApiStatus = "checking" | "ready" | "missing" | "error";

const ENDPOINT = "/api/api-keys";

/** Reads a JSON body, or null when the response is not JSON at all. */
async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) return null;
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

function asArray(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    const keys = (body as { keys?: unknown; items?: unknown }).keys ?? (body as { items?: unknown }).items;
    if (Array.isArray(keys)) return keys;
  }
  return [];
}

/** Defensive: the route may omit fields the UI reads, so every one gets a floor. */
function normalizeKey(raw: unknown): AgentKeySummary | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string") return null;
  const scopes = Array.isArray(r.scopes)
    ? (r.scopes.filter((s): s is AgentScope => ALL_AGENT_SCOPES.includes(s as AgentScope)))
    : [];
  const mode = r.destinationMode;
  return {
    id: r.id,
    name: typeof r.name === "string" && r.name.trim() ? r.name : "Unnamed agent",
    prefix: typeof r.prefix === "string" ? r.prefix : "",
    scopes,
    destinationMode: (mode === "own" || mode === "pinned" || mode === "any" ? mode : "own") as DestinationMode,
    defaultWorkspaceId: typeof r.defaultWorkspaceId === "string" ? r.defaultWorkspaceId : null,
    defaultWorkspaceName: typeof r.defaultWorkspaceName === "string" ? r.defaultWorkspaceName : null,
    maxQuality: (typeof r.maxQuality === "string" ? r.maxQuality : null) as Quality | null,
    maxModel: (typeof r.maxModel === "string" ? r.maxModel : null) as ModelId | null,
    dailyImageLimit: typeof r.dailyImageLimit === "number" ? r.dailyImageLimit : null,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : 0,
    lastUsedAt: typeof r.lastUsedAt === "number" ? r.lastUsedAt : null,
    expiresAt: typeof r.expiresAt === "number" ? r.expiresAt : null,
    revokedAt: typeof r.revokedAt === "number" ? r.revokedAt : null,
    status: r.status === "active" || r.status === "revoked" || r.status === "expired" ? r.status : undefined,
    usedToday: typeof r.usedToday === "number" ? r.usedToday : undefined,
  };
}

/** A key that still exists and has not been revoked. Expired ones stay listed. */
export function isLiveKey(key: AgentKeySummary): boolean {
  return !key.revokedAt && key.status !== "revoked";
}

/** One list request, resolved into exactly what the hook should store. */
async function fetchKeyList(): Promise<{ status: AgentApiStatus; keys: AgentKeySummary[] }> {
  const res = await fetch(ENDPOINT, { cache: "no-store" }).catch(() => null);
  if (!res) return { status: "error", keys: [] };
  const body = await readJson(res);
  if (res.status === 404 || res.status === 501 || body === null) {
    return { status: "missing", keys: [] };
  }
  if (!res.ok) return { status: "error", keys: [] };
  return {
    status: "ready",
    keys: asArray(body).map(normalizeKey).filter((k): k is AgentKeySummary => k !== null),
  };
}

export interface CreateResult {
  ok: boolean;
  token?: string;
  key?: AgentKeySummary;
  error?: string;
}

/**
 * List / create / revoke agent keys. Every path resolves rather than throws:
 * the endpoints are built by another workstream and may not exist yet, and a
 * settings panel must not take the app down when they don't.
 */
export function useAgentKeys(enabled = true) {
  const [keys, setKeys] = useState<AgentKeySummary[]>([]);
  const [status, setStatus] = useState<AgentApiStatus>("checking");
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // The request itself holds no state: it resolves to what the UI should show,
  // and the caller applies it from a callback. That keeps every setState out of
  // the synchronous effect path.
  const refresh = useCallback(() => {
    if (!enabled) return;
    void fetchKeyList().then((result) => {
      if (!aliveRef.current) return;
      setStatus(result.status);
      if (result.status !== "error") setKeys(result.keys);
    });
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createKey = useCallback(async (payload: CreateAgentKeyRequest): Promise<CreateResult> => {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await readJson(res);
      if (res.status === 404 || res.status === 501 || body === null) {
        return { ok: false, error: "This instance has no agent-key API yet. Update the server, then try again." };
      }
      if (!res.ok) {
        const message = typeof body.error === "string" ? body.error : `Could not create the key (${res.status}).`;
        return { ok: false, error: message };
      }
      // The token may arrive as `token`, and the row either at the top level or under `key`.
      const token = typeof body.token === "string" ? body.token
        : typeof body.key === "string" ? body.key
        : typeof body.apiKey === "string" ? body.apiKey
        : null;
      const rowSource = body.key && typeof body.key === "object" ? body.key : body;
      const key = normalizeKey(rowSource);
      if (!token || !key) {
        return { ok: false, error: "The server created the key but did not return it. Check the server logs." };
      }
      refresh();
      return { ok: true, token, key };
    } catch {
      return { ok: false, error: "Could not reach the server. Check your connection." };
    }
  }, [refresh]);

  const revokeKey = useCallback(async (id: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`${ENDPOINT}/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.status === 404 || res.status === 501) {
        return { ok: false, error: "This instance has no agent-key API yet." };
      }
      if (!res.ok) {
        const body = await readJson(res);
        const message = body && typeof body.error === "string" ? body.error : `Could not revoke the key (${res.status}).`;
        return { ok: false, error: message };
      }
      setKeys((prev) => prev.filter((k) => k.id !== id));
      refresh();
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not reach the server. Check your connection." };
    }
  }, [refresh]);

  return { keys, status, refresh, createKey, revokeKey };
}
