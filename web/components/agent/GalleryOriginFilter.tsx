"use client";

import { Bot, Images, User } from "lucide-react";
import { useApp, type OriginFilter } from "@/contexts/AppContext";

const OPTIONS: { id: OriginFilter; label: string; Icon: typeof Bot }[] = [
  { id: "all", label: "Everything", Icon: Images },
  { id: "user", label: "Yours", Icon: User },
  { id: "agent", label: "Agents", Icon: Bot },
];

/**
 * Provenance filter for the gallery. The gallery's own controls (workspace,
 * size) live in the header and are deliberately sparse, so this sits with the
 * agent settings that produce the images it filters. The choice is remembered
 * and applied to the query, not just to what is already loaded.
 */
export default function GalleryOriginFilter() {
  const { state, dispatch } = useApp();

  return (
    <div className="mt-3">
      <p className="mb-2 text-xs text-text-secondary/50">Show in the gallery</p>
      <div className="flex gap-2 rounded-xl border border-[var(--border)] bg-white/[0.03] p-2">
        {OPTIONS.map(({ id, label, Icon }) => {
          const active = state.originFilter === id;
          const activeClass = id === "agent"
            ? "bg-violet-400/15 text-violet-400 border border-violet-400/30"
            : "bg-accent/20 text-accent border border-accent/30";
          return (
            <button
              key={id}
              onClick={() => dispatch({ type: "SET_ORIGIN_FILTER", payload: id })}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors ${
                active ? activeClass : "bg-[var(--border)] text-text-secondary hover:text-text-primary border border-transparent"
              }`}
            >
              <Icon size={12} />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
