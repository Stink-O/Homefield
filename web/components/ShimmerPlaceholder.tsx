"use client";

import { useState, useEffect, useRef } from "react";
import { AlertCircle, RefreshCw, X } from "lucide-react";
import AgentBadge from "./agent/AgentBadge";

interface ShimmerPlaceholderProps {
  prompt: string;
  startedAt?: number;
  failed?: boolean;
  errorMessage?: string;
  generating?: boolean;
  /**
   * Name of the agent that started this generation, or null/undefined when the
   * user started it themselves. Rendered with the same badge the finished card
   * uses, so provenance is readable while the work is still in flight.
   */
  agentLabel?: string | null;
  onCancel?: () => void;
  onRetry?: () => void;
}

export default function ShimmerPlaceholder({ prompt, startedAt, failed, errorMessage, generating, agentLabel, onCancel, onRetry }: ShimmerPlaceholderProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const showElapsed = typeof window !== "undefined" && localStorage.getItem("showElapsedTime") === "true";
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (failed) return;
    // If the parent provides explicit generating state (e.g. from Replicate queue status), use it directly
    if (generating !== undefined) {
      // Syncing with an external signal (Replicate queue status) — intentional.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsGenerating(generating);
      return;
    }
    const elapsedMs = Date.now() - (startedAt ?? Date.now());
    const remaining = Math.max(0, 2500 - elapsedMs);
    if (remaining === 0) {
       
      setIsGenerating(true);
      return;
    }
    const timeout = setTimeout(() => {
      setIsGenerating(true);
    }, remaining);
    return () => clearTimeout(timeout);
  }, [startedAt, failed, generating]);

  useEffect(() => {
    if (!showElapsed || failed) return;
    // Seed the elapsed counter immediately so the badge doesn't show 0s for a second.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setElapsed(Math.floor((Date.now() - (startedAt ?? Date.now())) / 1000));
    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - (startedAt ?? Date.now())) / 1000));
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [showElapsed, startedAt, failed]);

  if (failed) {
    return (
      <div className="relative w-full h-full overflow-hidden bg-red-500/[0.06]">
        <div className="absolute inset-0 ring-1 ring-inset ring-red-500/20" />
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 gap-2">
          <AlertCircle size={16} className="text-red-400/50 shrink-0" />
          <p className="text-center text-xs text-text-secondary/70 line-clamp-2 max-w-[80%]">
            {errorMessage || "Generation failed"}
          </p>
          <div className="mt-1 flex items-center gap-2">
            {onRetry && (
              <button
                onClick={onRetry}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--chrome-surface)] px-3 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-[var(--chrome-surface-hover)] hover:text-text-primary"
              >
                <RefreshCw size={11} />
                Retry
              </button>
            )}
            {onCancel && (
              <button
                onClick={onCancel}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--chrome-surface)] px-3 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-[var(--chrome-surface-hover)] hover:text-text-primary"
              >
                <X size={11} />
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="@container relative w-full h-full overflow-hidden">
      {/* Shimmer sweep */}
      <div className="shimmer absolute inset-0" />

      {/* Accent pulse border */}
      <div className="absolute inset-0 ring-1 ring-inset ring-accent/30 animate-pulse" />

      {/* Prompt label */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <p className="text-center text-xs text-text-secondary/60 line-clamp-2 max-w-[80%]">
          {prompt}
        </p>
      </div>

      {/* State indicator + cancel, led by the agent badge when one applies.
          Bounded by left-3/right-3 rather than centred on the card's midpoint so
          the badge can never push the row past the card edge; with no badge the
          row still centres exactly as before. */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-center gap-1.5">
        {/* Provenance while the work is still in flight. Same component, same
            `onImage`/`compactLabel` treatment and the same leading position in
            the bottom-line cluster that ImageCard gives it, so the badge reads
            as the same object before and after the image lands. */}
        {agentLabel && <AgentBadge label={agentLabel} onImage compactLabel className="min-w-0 shrink" />}
        <div
          className={`h-1 w-1 rounded-full animate-pulse shrink-0 ${
            isGenerating ? "bg-green-500/60" : "bg-accent/70"
          }`}
        />
        <span
          className={`text-[10px] font-mono ${
            isGenerating ? "text-green-400/90" : "text-text-secondary/60"
          }`}
        >
          {isGenerating ? "Generating..." : "Preparing..."}
        </span>
        {showElapsed && (
          <span className="hidden [@container(min-width:140px)]:inline text-[10px] font-mono text-text-secondary/40">
            {elapsed}s
          </span>
        )}
        {onCancel && (
          <button
            onClick={onCancel}
            title="Cancel"
            className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-secondary/50 transition-colors hover:text-text-secondary"
          >
            <X size={10} />
          </button>
        )}
      </div>
    </div>
  );
}
