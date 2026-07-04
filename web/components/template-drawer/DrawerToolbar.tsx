"use client";

import { useRef } from "react";
import { X, Search, Plus, RefreshCw } from "lucide-react";

// Search field, For You refresh, New button, and the subcategory pill row.
export default function DrawerToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  showForYouRefresh,
  onRefreshForYou,
  onOpenCreate,
  showSubcategories,
  subcategory,
  onSubcategoryChange,
  subcategoryEntries,
  subcategoryLabels,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  showForYouRefresh: boolean;
  onRefreshForYou: () => void;
  onOpenCreate: () => void;
  showSubcategories: boolean;
  subcategory: string;
  onSubcategoryChange: (value: string) => void;
  subcategoryEntries: [string, number][];
  subcategoryLabels: Record<string, string>;
}) {
  const refreshIconRef = useRef<HTMLSpanElement>(null);

  return (
    <div className="px-4 pt-3 pb-2 border-b border-[var(--chrome-border)] shrink-0 space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary/50 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            style={{ fontSize: "16px" }}
            className="w-full rounded-lg border border-[var(--chrome-border)] bg-[var(--chrome-surface)] pl-9 pr-4 py-2 text-sm text-text-primary placeholder-text-secondary/40 outline-none focus:border-[var(--chrome-border-strong)] transition-colors"
          />
          {search && (
            <button onClick={() => onSearchChange("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary/50 hover:text-text-secondary transition-colors">
              <X size={13} />
            </button>
          )}
        </div>
        {showForYouRefresh && (
          <button
            onClick={() => {
              const el = refreshIconRef.current;
              if (el) {
                el.style.animation = "none";
                void el.offsetHeight; // force reflow
                el.style.animation = "refresh-flick 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97) forwards";
              }
              onRefreshForYou();
            }}
            className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-hover)] transition-colors text-text-secondary/80 hover:text-text-primary"
            title="Refresh suggestions"
          >
            <span ref={refreshIconRef} style={{ display: "flex" }}>
              <RefreshCw size={15} />
            </span>
          </button>
        )}
        <button
          onClick={onOpenCreate}
          className="shrink-0 flex items-center gap-1.5 rounded-lg bg-[#a3e635] hover:bg-[#bef264] px-3 py-2 text-sm font-semibold text-black transition-colors"
        >
          <Plus size={14} />
          New
        </button>
      </div>

      {showSubcategories && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          <button
            onClick={() => onSubcategoryChange("all")}
            className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-100 ${
              subcategory === "all"
                ? "bg-[#a3e635]/15 text-[#a3e635] border border-[#a3e635]/30"
                : "bg-[var(--chrome-surface)] text-text-secondary/80 border border-[var(--chrome-border)] hover:text-text-primary/80 hover:bg-[var(--chrome-surface-hover)]"
            }`}
          >
            All
          </button>
          {subcategoryEntries.map(([key, count]) => {
            const isActive = subcategory === key;
            return (
              <button
                key={key}
                onClick={() => onSubcategoryChange(key)}
                className={`shrink-0 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-100 ${
                  isActive
                    ? "bg-[#a3e635]/15 text-[#a3e635] border border-[#a3e635]/30"
                    : "bg-[var(--chrome-surface)] text-text-secondary/80 border border-[var(--chrome-border)] hover:text-text-primary/80 hover:bg-[var(--chrome-surface-hover)]"
                }`}
              >
                {subcategoryLabels[key] ?? key}
                <span className={`tabular-nums ${isActive ? "text-[#a3e635]/60" : "text-text-secondary/40"}`}>{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
