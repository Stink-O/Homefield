"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronDown, User } from "lucide-react";
import { useApp, type OriginFilter } from "@/contexts/AppContext";
import { AGENT_TEXT, agentLabelOf } from "../agent/agentTheme";

const OPTIONS: { id: OriginFilter; label: string; hint: string }[] = [
  { id: "all", label: "Everything", hint: "Yours and your agents'" },
  { id: "user", label: "Yours", hint: "Only what you made" },
  { id: "agent", label: "Agents", hint: "Only what your agents made" },
];

/**
 * Scopes the gallery by who made an image. Sits beside the workspace switcher
 * because both answer the same question — what am I looking at.
 *
 * It renders only once agent-made images actually exist in view, or while a
 * filter is active, so an instance that never uses agent access never grows a
 * control it cannot use — and no extra request is needed to decide that.
 * When a filter IS active the chip takes the accent and names it: a filtered gallery
 * that looks unfiltered reads as missing images.
 */
export default function OriginFilterChip() {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Derived from what is already loaded rather than a keys lookup. Once a
  // filter is active the chip must stay visible regardless, or the only clue
  // that images are being hidden disappears with them.
  const active = state.originFilter !== "all";
  const hasAgentImages = state.history.some((img) => agentLabelOf(img) !== null);
  if (!active && !hasAgentImages) return null;

  const current = OPTIONS.find((o) => o.id === state.originFilter) ?? OPTIONS[0];

  return (
    <div className="relative ml-0.5 sm:ml-1" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Showing: ${current.hint.toLowerCase()}`}
        className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--border)] ${
          active ? AGENT_TEXT : "text-text-secondary"
        }`}
        suppressHydrationWarning
      >
        {state.originFilter === "user" ? <User size={13} /> : <Bot size={13} />}
        {active && <span className="hidden sm:inline">{current.label}</span>}
        <ChevronDown size={12} className="opacity-60" />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[190px] rounded-xl border border-[var(--border)] bg-surface-elevated shadow-xl py-1">
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                dispatch({ type: "SET_ORIGIN_FILTER", payload: o.id });
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--border)] transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${o.id === state.originFilter ? AGENT_TEXT : "text-text-primary"}`}>
                  {o.label}
                </p>
                <p className="text-[11px] text-text-secondary/60">{o.hint}</p>
              </div>
              {o.id === state.originFilter && <Check size={12} className={`${AGENT_TEXT} shrink-0`} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
