"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, X } from "lucide-react";
import { DEFAULT_AGENT_SCOPES } from "@/lib/agent/contract";
import { useApp } from "@/contexts/AppContext";
import AgentKeyList from "./AgentKeyList";
import { AGENT_BUTTON, AGENT_TEXT } from "./agentTheme";
import { StepDestination, StepIdentity, StepLimits, StepScopes } from "./setup/ConfigSteps";
import { StepConfirm, StepConnect, StepCreate } from "./setup/KeySteps";
import type { AgentKeyDraft, AgentKeySummary } from "./types";
import { useAgentKeys } from "./useAgentKeys";

const TOTAL_STEPS = 7;

const STEP_TITLES = [
  "Name", "Destination", "Permissions", "Ceiling", "Key", "Connect", "Confirm",
];

/**
 * The agent-access setup flow. Settings is a crowded modal, so this takes the
 * whole screen: seven steps from naming an agent to watching its first call
 * land. Nothing here assumes the key API exists — every failure is reported in
 * place rather than thrown.
 */
export default function AgentSetupFlow({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp();
  const workspaces = state.workspaces;
  const { keys, status, refresh, createKey, revokeKey } = useAgentKeys();

  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<AgentKeyDraft>(() => ({
    name: "",
    destinationMode: "own",
    workspaceName: "",
    pinnedWorkspaceId: workspaces[0]?.id ?? "",
    scopes: [...DEFAULT_AGENT_SCOPES],
    // Deliberately modest: the mid model, one megapixel, a small day's work.
    maxModel: "gemini-3.1-flash-image",
    maxQuality: "1K",
    dailyImageLimit: 25,
  }));
  const [workspaceNameTouched, setWorkspaceNameTouched] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<AgentKeySummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const patch = useCallback((next: Partial<AgentKeyDraft>) => {
    setDraft((prev) => ({ ...prev, ...next }));
  }, []);

  const destinationLabel = useMemo(() => {
    if (draft.destinationMode === "any") return "Any of your workspaces";
    if (draft.destinationMode === "pinned") {
      const name = workspaces.find((w) => w.id === draft.pinnedWorkspaceId)?.name;
      return name ? `Pinned to ${name}` : "Pinned workspace";
    }
    return `New workspace · ${draft.workspaceName.trim() || draft.name.trim() || "Agent"}`;
  }, [draft.destinationMode, draft.pinnedWorkspaceId, draft.workspaceName, draft.name, workspaces]);

  // The freshly-listed row wins: it carries lastUsedAt and today's usage.
  const liveKey = createdKey ? keys.find((k) => k.id === createdKey.id) ?? createdKey : null;

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    const result = await createKey({
      name: draft.name.trim(),
      scopes: draft.scopes,
      destinationMode: draft.destinationMode,
      workspaceId: draft.destinationMode === "pinned" ? draft.pinnedWorkspaceId : null,
      maxQuality: draft.maxQuality,
      maxModel: draft.maxModel,
      dailyImageLimit: draft.dailyImageLimit,
    });
    if (!result.ok) {
      setCreating(false);
      setError(result.error ?? "Could not create the key.");
      return;
    }
    // The server names the agent's own workspace after the agent. Apply the
    // operator's edit as a rename; best effort, the key is already valid.
    const wanted = draft.workspaceName.trim();
    const workspaceId = result.key?.defaultWorkspaceId;
    if (draft.destinationMode === "own" && workspaceId && wanted && wanted !== draft.name.trim()) {
      await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: wanted }),
      }).catch(() => null);
    }
    // Pull the new workspace into the header list without a page reload.
    const list = await fetch("/api/workspaces").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (Array.isArray(list) && list.length > 0) dispatch({ type: "INIT_WORKSPACES", payload: list });
    setCreating(false);
    setToken(result.token ?? null);
    setCreatedKey(result.key ?? null);
  };

  const canAdvance = (() => {
    if (step === 1) return draft.name.trim().length > 0;
    if (step === 2) return draft.destinationMode !== "pinned" || !!draft.pinnedWorkspaceId;
    if (step === 3) return draft.scopes.length > 0;
    if (step === 5) return !creating;
    if (step === 6) return !!token;
    return true;
  })();

  const primaryLabel = (() => {
    if (step === 5 && !token) return creating ? "Creating…" : "Create key";
    if (step === TOTAL_STEPS) return "Done";
    return "Continue";
  })();

  const handlePrimary = () => {
    if (step === 5 && !token) { void handleCreate(); return; }
    if (step === TOTAL_STEPS) { onClose(); return; }
    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  };

  // Once the key exists the earlier choices are settled; back-stepping into
  // them would only be misleading.
  const minStep = token ? 5 : 1;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[120] flex flex-col"
      style={{ background: "var(--bg)" }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex-shrink-0 border-b border-[var(--border)]" style={{ background: "var(--surface)" }}>
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-text-primary">Agent access</h2>
            <p className="text-xs text-text-secondary/60">
              Step {step} of {TOTAL_STEPS} · <span className={AGENT_TEXT}>{STEP_TITLES[step - 1]}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-[var(--border)] hover:text-text-primary"
            aria-label="Close agent setup"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mx-auto flex w-full max-w-2xl gap-1 px-5 pb-3">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span
              key={i}
              className={`h-0.5 flex-1 rounded-full transition-colors ${
                i < step ? "bg-violet-400" : "bg-[var(--border)]"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-5 py-6">
          {step === 1 && (
            <>
              <StepIdentity draft={draft} onChange={patch} workspaceNameTouched={workspaceNameTouched} />
              <div className="mt-8 border-t border-[var(--border)] pt-5">
                <p className="mb-3 text-xs font-medium uppercase tracking-wider text-text-secondary/50">
                  Agents already connected
                </p>
                <AgentKeyList keys={keys} status={status} workspaces={workspaces} onRevoke={revokeKey} />
              </div>
            </>
          )}
          {step === 2 && (
            <StepDestination
              draft={draft}
              onChange={patch}
              workspaces={workspaces}
              onWorkspaceNameEdit={() => setWorkspaceNameTouched(true)}
            />
          )}
          {step === 3 && <StepScopes draft={draft} onChange={patch} />}
          {step === 4 && <StepLimits draft={draft} onChange={patch} />}
          {step === 5 && (
            <StepCreate draft={draft} token={token} destinationLabel={destinationLabel} error={error} />
          )}
          {step === 6 && (
            <StepConnect token={token ?? ""} origin={typeof window === "undefined" ? "" : window.location.origin} />
          )}
          {step === 7 && (
            <StepConfirm
              summary={liveKey}
              dailyImageLimit={draft.dailyImageLimit}
              onRefresh={refresh}
              apiMissing={status === "missing"}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-[var(--border)]" style={{ background: "var(--surface)" }}>
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-5 py-4">
          <button
            onClick={() => setStep((s) => Math.max(minStep, s - 1))}
            disabled={step <= minStep}
            className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary disabled:opacity-0"
          >
            <ChevronLeft size={14} />
            Back
          </button>
          <button
            onClick={handlePrimary}
            disabled={!canAdvance}
            className={`rounded-xl px-5 py-2 text-sm font-semibold transition-colors ${AGENT_BUTTON}`}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
