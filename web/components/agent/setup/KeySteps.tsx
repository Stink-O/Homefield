"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { MODELS } from "@/lib/types";
import type { AgentKeyDraft, AgentKeySummary } from "../types";
import { Callout, CopyBlock, StepHeading, timeAgo } from "../ui";
import { AGENT_TEXT } from "../agentTheme";

const CLIENTS = ["Claude Code", "Claude Desktop", "Other"] as const;
type Client = (typeof CLIENTS)[number];

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] py-2 last:border-b-0">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className="text-right text-xs font-medium text-text-primary">{value}</span>
    </div>
  );
}

/** Step 5 — mint the key, then show it exactly once. */
export function StepCreate({
  draft, token, destinationLabel, error,
}: {
  draft: AgentKeyDraft;
  token: string | null;
  destinationLabel: string;
  error: string | null;
}) {
  const modelLabel = MODELS.find((m) => m.id === draft.maxModel)?.label ?? draft.maxModel;

  if (token) {
    return (
      <>
        <StepHeading
          title="Your key"
          description="Copy it now and paste it into your client on the next step."
        />
        <div className="space-y-4">
          <CopyBlock value={token} label="Agent key" />
          <Callout tone="warn">
            This is the only time the key is shown. It is stored as a hash, so nobody — including this
            instance — can display it again. If you lose it, revoke the key and create another.
          </Callout>
        </div>
      </>
    );
  }

  return (
    <>
      <StepHeading
        title="Create the key"
        description="Check the summary, then create the key. It is shown once, right after."
      />
      <div className="rounded-xl border border-[var(--border)] bg-white/[0.03] px-3 py-1">
        <SummaryRow label="Name" value={draft.name.trim() || "Unnamed agent"} />
        <SummaryRow label="Destination" value={destinationLabel} />
        <SummaryRow label="Permissions" value={draft.scopes.length ? draft.scopes.join(", ") : "none"} />
        <SummaryRow label="Ceiling" value={`${modelLabel} · ${draft.maxQuality}`} />
        <SummaryRow label="Daily images" value={String(draft.dailyImageLimit)} />
      </div>
      {error && <div className="mt-4"><Callout tone="warn">{error}</Callout></div>}
    </>
  );
}

/** Step 6 — paste the key into a client. */
export function StepConnect({ token, origin }: { token: string; origin: string }) {
  const [client, setClient] = useState<Client>("Claude Code");
  const endpoint = `${origin}/api/mcp`;
  const insecure = origin.startsWith("http://");

  return (
    <>
      <StepHeading
        title="Connect a client"
        description="Both fields below are already filled in with this instance's address and the key you just created."
      />

      <div className="mb-4 flex gap-1 rounded-xl p-1" style={{ background: "var(--chrome-surface)" }}>
        {CLIENTS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setClient(c)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              client === c ? `bg-violet-400/15 ${AGENT_TEXT}` : "text-text-secondary/60 hover:text-text-secondary"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {client === "Claude Code" && (
        <div className="space-y-4">
          <CopyBlock
            label="Run this in your terminal"
            value={`claude mcp add --transport http homefield ${endpoint} --header "Authorization: Bearer ${token}"`}
          />
          <p className="text-xs text-text-secondary/60 leading-relaxed">
            Claude Code accepts a local address, so this works against a machine on your own network.
            Check it landed with <code className="font-mono text-text-secondary">claude mcp list</code>.
          </p>
          {insecure && (
            <Callout tone="warn">
              This instance is served over plain HTTP. The key travels in the clear on your network and
              anyone who can watch that traffic can reuse it. Fine on a trusted LAN; put it behind HTTPS
              before it leaves one.
            </Callout>
          )}
        </div>
      )}

      {client === "Claude Desktop" && (
        <div className="space-y-4">
          <Callout tone="warn">
            Claude Desktop and claude.ai refuse <code className="font-mono">localhost</code> and LAN
            addresses — a remote MCP server must be a public HTTPS URL. A HomeField running at home
            cannot be added directly.
          </Callout>
          <p className="text-xs text-text-secondary/60 leading-relaxed">
            The way around it is <code className="font-mono text-text-secondary">npx mcp-remote</code>,
            a bridge that runs on your own machine and can reach this instance. Add this to
            <span className="text-text-secondary"> claude_desktop_config.json</span> and restart the app.
          </p>
          <CopyBlock
            label="claude_desktop_config.json"
            value={`{
  "mcpServers": {
    "homefield": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "${endpoint}",
        "--header", "Authorization: Bearer ${token}"
      ]
    }
  }
}`}
          />
          <p className="text-xs text-text-secondary/60 leading-relaxed">
            claude.ai in the browser has no local bridge: connecting it needs this instance published at a
            real HTTPS hostname, through a tunnel or a reverse proxy with a certificate.
          </p>
        </div>
      )}

      {client === "Other" && (
        <div className="space-y-4">
          <CopyBlock label="MCP endpoint (Streamable HTTP)" value={endpoint} />
          <CopyBlock label="Authorization header" value={`Authorization: Bearer ${token}`} />
          <p className="text-xs text-text-secondary/60 leading-relaxed">
            Any client that speaks MCP over HTTP and can send a static header will work. Send the header on
            every request; there is no login or refresh step.
          </p>
          {insecure && (
            <Callout tone="warn">
              Served over plain HTTP: the bearer token is readable by anything on the path between the
              client and this machine.
            </Callout>
          )}
        </div>
      )}
    </>
  );
}

/** Step 7 — did it actually connect, and what has it spent. */
export function StepConfirm({
  summary, dailyImageLimit, onRefresh, apiMissing,
}: {
  summary: AgentKeySummary | null;
  dailyImageLimit: number;
  onRefresh: () => void;
  apiMissing: boolean;
}) {
  const [checking, setChecking] = useState(false);
  const connected = !!summary?.lastUsedAt;
  const used = summary?.usedToday ?? 0;
  const limit = summary?.dailyImageLimit ?? dailyImageLimit;

  // Poll while this step is on screen so the indicator flips the moment the
  // agent makes its first call. onRefresh is stable (useCallback in the hook).
  useEffect(() => {
    if (apiMissing) return;
    const id = setInterval(onRefresh, 5000);
    return () => clearInterval(id);
  }, [onRefresh, apiMissing]);

  const handleCheck = () => {
    setChecking(true);
    onRefresh();
    setTimeout(() => setChecking(false), 800);
  };

  return (
    <>
      <StepHeading
        title="Confirm it connected"
        description="Ask the agent to generate something. This flips as soon as the key is used for the first time."
      />

      <div className="rounded-xl border border-[var(--border)] bg-white/[0.03] p-4">
        <div className="flex items-center gap-3">
          {connected ? (
            <CheckCircle2 size={18} className="flex-shrink-0 text-violet-400" />
          ) : (
            <Loader2 size={18} className="flex-shrink-0 animate-spin text-text-secondary/50" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-primary">
              {connected ? "Connected" : "Waiting for the first call"}
            </p>
            <p className="mt-0.5 text-xs text-text-secondary/60">
              {connected ? `Last used ${timeAgo(summary?.lastUsedAt)}` : "Nothing has used this key yet."}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCheck}
            disabled={apiMissing}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-[var(--border)] px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40"
          >
            <RefreshCw size={11} className={checking ? "animate-spin" : ""} />
            Check now
          </button>
        </div>

        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Images today</span>
            <span className="text-xs font-semibold text-text-primary">
              {used} <span className="text-text-secondary/50">/ {limit ?? "unlimited"}</span>
            </span>
          </div>
          {limit ? (
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full rounded-full bg-violet-400 transition-[width] duration-300"
                style={{ width: `${Math.min(100, Math.round((used / limit) * 100))}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>

      {apiMissing && (
        <div className="mt-4">
          <Callout tone="warn">
            The key API is not available on this instance, so usage cannot be read back yet.
          </Callout>
        </div>
      )}
    </>
  );
}
