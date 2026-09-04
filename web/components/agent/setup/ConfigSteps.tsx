"use client";

import type { AgentScope } from "@/lib/agent/contract";
import { ALL_AGENT_SCOPES } from "@/lib/agent/contract";
import { MODELS, QUALITIES, type ModelId, type Quality, type Workspace } from "@/lib/types";
import type { AgentKeyDraft } from "../types";
import { Callout, CheckOption, OptionCard, SegmentedRow, StepHeading, TextField } from "../ui";

type Patch = (patch: Partial<AgentKeyDraft>) => void;

interface StepProps {
  draft: AgentKeyDraft;
  onChange: Patch;
}

/** Step 1 — what this agent is called. The name becomes the badge label. */
export function StepIdentity({ draft, onChange, workspaceNameTouched }: StepProps & { workspaceNameTouched: boolean }) {
  return (
    <>
      <StepHeading
        title="Name the agent"
        description="Something you will recognise later. This name is stamped on every image the agent makes, so it is what you will see on the card."
      />
      <TextField
        label="Agent name"
        value={draft.name}
        placeholder="Claude Code on my laptop"
        hint="Shown as the badge on agent-made images. You can revoke by this name later."
        onChange={(name) => {
          // The workspace name trails the agent name until the operator edits it.
          onChange(workspaceNameTouched ? { name } : { name, workspaceName: name });
        }}
      />
    </>
  );
}

/** Step 2 — where the agent is allowed to write. */
export function StepDestination({
  draft, onChange, workspaces, onWorkspaceNameEdit,
}: StepProps & { workspaces: Workspace[]; onWorkspaceNameEdit: () => void }) {
  return (
    <>
      <StepHeading
        title="Where it generates"
        description="Every image the agent makes lands somewhere. Keeping it in its own workspace means an agent can never scatter images through your collections."
      />
      <div className="space-y-2">
        <OptionCard
          selected={draft.destinationMode === "own"}
          onClick={() => onChange({ destinationMode: "own" })}
          title="Its own workspace"
          description="A new workspace, used by this agent and nothing else. Recommended."
        >
          <TextField
            label="Workspace name"
            value={draft.workspaceName}
            placeholder={draft.name || "Agent"}
            onChange={(workspaceName) => { onWorkspaceNameEdit(); onChange({ workspaceName }); }}
          />
        </OptionCard>

        <OptionCard
          selected={draft.destinationMode === "pinned"}
          onClick={() => onChange({ destinationMode: "pinned" })}
          title="One existing workspace"
          description="Pin the agent to a workspace you already have. It cannot write anywhere else."
        >
          <div className="flex flex-wrap gap-2">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() => onChange({ pinnedWorkspaceId: ws.id })}
                className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  draft.pinnedWorkspaceId === ws.id
                    ? "border-accent/40 bg-accent/15 text-accent"
                    : "border-transparent bg-[var(--border)] text-text-secondary hover:text-text-primary"
                }`}
              >
                {ws.name}
              </button>
            ))}
          </div>
        </OptionCard>

        <OptionCard
          selected={draft.destinationMode === "any"}
          onClick={() => onChange({ destinationMode: "any" })}
          title="Any of your workspaces"
          description="The agent picks a workspace on each call. Convenient, and the least contained."
        />
      </div>
    </>
  );
}

const SCOPE_COPY: Record<AgentScope, { title: string; description: string; warning?: string }> = {
  generate: {
    title: "Generate images",
    description: "Create images in the destination you chose. This is what most agents need.",
  },
  upload: {
    title: "Upload images",
    description: "Put image files from its own disk into the destination you chose, to edit them by reference. Uploads do not count against the daily image budget.",
  },
  templates: {
    title: "Read and write templates",
    description: "Use your prompt templates, and save new ones back to your library.",
  },
  delete: {
    title: "Delete images",
    description: "Remove images from your library.",
    warning: "Deletion is permanent. Anything the agent removes is gone, with no confirmation step.",
  },
  publish: {
    title: "Publish to the shared space",
    description: "Move images into the shared space of this instance.",
    warning: "Published images become visible to everyone with an account here.",
  },
};

/** Step 3 — the scopes. Only "generate" is ticked to begin with. */
export function StepScopes({ draft, onChange }: StepProps) {
  const toggle = (scope: AgentScope, next: boolean) => {
    const scopes = next
      ? [...draft.scopes, scope].filter((s, i, all) => all.indexOf(s) === i)
      : draft.scopes.filter((s) => s !== scope);
    // Keep the stored order stable so the summary reads the same every time.
    onChange({ scopes: ALL_AGENT_SCOPES.filter((s) => scopes.includes(s)) });
  };

  return (
    <>
      <StepHeading
        title="What it may do"
        description="Anything left unticked is refused at the door, whatever the agent asks for. Start with the least you need. You can always mint a second key later."
      />
      <div className="space-y-2">
        {ALL_AGENT_SCOPES.map((scope) => (
          <CheckOption
            key={scope}
            checked={draft.scopes.includes(scope)}
            onChange={(next) => toggle(scope, next)}
            title={SCOPE_COPY[scope].title}
            description={SCOPE_COPY[scope].description}
            warning={SCOPE_COPY[scope].warning}
          />
        ))}
      </div>
      {draft.scopes.length === 0 && (
        <div className="mt-3">
          <Callout tone="warn">A key with no permissions can authenticate but do nothing at all.</Callout>
        </div>
      )}
    </>
  );
}

const DAILY_PRESETS = [10, 25, 100];

/** Step 4 — the spend ceiling. Deliberately low by default. */
export function StepLimits({ draft, onChange }: StepProps) {
  return (
    <>
      <StepHeading
        title="Spend ceiling"
        description="The most this key may ask for. A request above the ceiling is refused rather than downgraded, so an agent cannot quietly spend more than you meant."
      />
      <div className="space-y-5">
        <SegmentedRow<ModelId>
          label="Highest model"
          value={draft.maxModel}
          onChange={(maxModel) => onChange({ maxModel })}
          options={MODELS.map((m) => ({ id: m.id, label: m.label }))}
        />
        <SegmentedRow<Quality>
          label="Highest quality"
          value={draft.maxQuality}
          onChange={(maxQuality) => onChange({ maxQuality })}
          options={QUALITIES.map((q) => ({ id: q.id, label: q.label }))}
        />
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-text-secondary/50">Images per day</p>
          <div className="mt-2 flex items-center gap-2">
            {DAILY_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange({ dailyImageLimit: n })}
                className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                  draft.dailyImageLimit === n
                    ? "border-accent/40 bg-accent/15 text-accent"
                    : "border-transparent bg-[var(--border)] text-text-secondary hover:text-text-primary"
                }`}
              >
                {n}
              </button>
            ))}
            <input
              type="number"
              min={1}
              max={10_000}
              value={draft.dailyImageLimit}
              onChange={(e) => onChange({ dailyImageLimit: Math.max(1, Math.min(10_000, Number(e.target.value) || 1)) })}
              className="w-24 rounded-xl border border-[var(--border)] bg-white/[0.03] px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
            />
          </div>
          <p className="mt-2 text-xs text-text-secondary/50">Counted per UTC day and reset at midnight UTC.</p>
        </div>
      </div>
    </>
  );
}
