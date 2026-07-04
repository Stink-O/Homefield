"use client";

import { CATEGORIES, type CategoryKey } from "./constants";

export default function CategorySidebar({
  open,
  category,
  getCount,
  onSelect,
}: {
  open: boolean;
  category: CategoryKey;
  getCount: (val: CategoryKey) => number;
  onSelect: (val: CategoryKey) => void;
}) {
  return (
    <aside
      className={`shrink-0 border-r border-[var(--chrome-border)] overflow-y-auto ${open ? "block" : "hidden"} sm:block w-full sm:w-[220px] absolute sm:relative inset-0 z-10 sm:z-auto`}
      style={{ background: "var(--surface)" }}
    >
      <div className="p-3 space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50 px-2 py-2">
          Categories
        </p>
        {CATEGORIES.map((cat) => {
          const count    = getCount(cat.value);
          const isActive = category === cat.value;
          const isMineEntry = cat.value === "mine";
          const isFavsEntry = cat.value === "favorites";
          return (
            <button
              key={cat.value}
              onClick={() => onSelect(cat.value)}
              className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors duration-100 text-left ${
                isActive
                  ? isMineEntry
                    ? "bg-[#a3e635]/10 text-[#a3e635] font-medium"
                    : isFavsEntry
                    ? "bg-red-500/10 text-red-400 font-medium"
                    : "bg-[#a3e635]/10 text-[#a3e635] font-medium"
                  : "text-text-secondary hover:bg-[var(--chrome-surface)] hover:text-text-primary"
              }`}
            >
              <span className="flex items-center gap-2">
                {cat.icon && (
                  <span className={
                    isActive && isFavsEntry ? "text-red-400"
                    : isActive ? "text-[#a3e635]"
                    : "text-text-secondary/50"
                  }>
                    {cat.icon}
                  </span>
                )}
                {cat.label}
              </span>
              {count > 0 && (
                <span className={`text-[11px] tabular-nums ${
                  isActive
                    ? isFavsEntry ? "text-red-400/70" : "text-[#a3e635]/70"
                    : "text-text-secondary/50"
                }`}>
                  {count.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
