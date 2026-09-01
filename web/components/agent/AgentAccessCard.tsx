"use client";

import { Bot } from "lucide-react";
import { AGENT_TEXT } from "./agentTheme";
import { isLiveKey, useAgentKeys } from "./useAgentKeys";

/**
 * The settings entry point, shaped like the "Generation key" card directly
 * above it. Everything else about agent access lives in its own full-screen
 * flow — settings is already a crowded modal.
 */
export default function AgentAccessCard({ onOpen }: { onOpen: () => void }) {
  const { keys, status } = useAgentKeys();
  const live = keys.filter(isLiveKey);
  const connected = live.length > 0;

  const subtitle = status === "missing"
    ? "Server support for agent keys is not installed yet"
    : connected
      ? live.map((k) => k.name).join(", ")
      : "Let Claude Code or another client generate into your library";

  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-3 border border-[var(--border)]">
      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${connected ? "bg-accent/12" : "bg-[var(--border)]"}`}>
        <Bot size={15} className={connected ? AGENT_TEXT : "text-text-secondary"} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text-primary">
          {connected
            ? `${live.length} agent${live.length === 1 ? "" : "s"} connected`
            : "No agents connected"}
        </p>
        <p className="truncate text-xs text-text-secondary/50">{subtitle}</p>
      </div>
      <button
        onClick={onOpen}
        className="flex-shrink-0 rounded-lg bg-[var(--border)] px-3 py-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
      >
        {connected ? "Manage" : "Set up"}
      </button>
    </div>
  );
}
