"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import type { Workspace } from "@/lib/types";
import type { AgentKeySummary } from "./types";
import { isLiveKey, type AgentApiStatus } from "./useAgentKeys";
import { Callout, timeAgo } from "./ui";
import { AGENT_TEXT } from "./agentTheme";

/** Where this key is allowed to write, in words. */
export function describeDestination(key: AgentKeySummary, workspaces: Workspace[]): string {
  if (key.destinationMode === "any") return "Any workspace";
  const name =
    key.defaultWorkspaceName ??
    workspaces.find((w) => w.id === key.defaultWorkspaceId)?.name ??
    null;
  if (key.destinationMode === "own") return name ? `Own workspace · ${name}` : "Its own workspace";
  return name ? `Pinned to ${name}` : "Pinned workspace";
}

export default function AgentKeyList({
  keys, status, workspaces, onRevoke,
}: {
  keys: AgentKeySummary[];
  status: AgentApiStatus;
  workspaces: Workspace[];
  onRevoke: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRevoke = async (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setBusyId(id);
    setError(null);
    const result = await onRevoke(id);
    setBusyId(null);
    setConfirmId(null);
    if (!result.ok) setError(result.error ?? "Could not revoke the key.");
  };

  if (status === "checking") {
    return <p className="text-xs text-text-secondary/50">Checking for existing agents…</p>;
  }

  if (status === "missing") {
    return (
      <Callout>
        This instance does not expose the agent-key API yet, so existing agents cannot be listed. The
        setup flow still records what you choose, and will create the key once the server has it.
      </Callout>
    );
  }

  if (status === "error") {
    return <Callout tone="warn">Could not read the list of agents from the server.</Callout>;
  }

  const live = keys.filter(isLiveKey);
  if (live.length === 0) {
    return <p className="text-xs text-text-secondary/50">No agents connected yet.</p>;
  }

  return (
    <div className="space-y-2">
      {live.map((key) => (
        <div
          key={key.id}
          className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/[0.03] p-3"
        >
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-violet-400/12">
            <Bot size={15} className={AGENT_TEXT} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm text-text-primary">{key.name}</p>
              {key.prefix && (
                <code className="flex-shrink-0 rounded bg-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                  {key.prefix}…
                </code>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-text-secondary/50">
              {describeDestination(key, workspaces)} · last used {timeAgo(key.lastUsedAt)}
              {key.status === "expired" && " · expired"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleRevoke(key.id)}
            onBlur={() => setConfirmId((id) => (id === key.id ? null : id))}
            disabled={busyId === key.id}
            className={`flex-shrink-0 rounded-lg px-3 py-2 text-xs transition-colors disabled:opacity-40 ${
              confirmId === key.id
                ? "bg-red-500 text-white"
                : "bg-[var(--border)] text-text-secondary hover:text-red-400"
            }`}
          >
            {busyId === key.id ? "Revoking…" : confirmId === key.id ? "Confirm?" : "Revoke"}
          </button>
        </div>
      ))}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
