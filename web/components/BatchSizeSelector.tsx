"use client";

import { useState, useRef, useEffect } from "react";
import { Minus, Plus, Check } from "lucide-react";
import { useApp } from "@/contexts/AppContext";
import { motion, AnimatePresence } from "framer-motion";
import type { BatchSize } from "@/lib/types";

const DOT_R = 1.6;
function BatchDots({ n }: { n: number }) {
  const dots: [number, number][] =
    n === 1 ? [[8, 8]] :
    n === 2 ? [[5, 8], [11, 8]] :
    n === 3 ? [[5, 5], [11, 5], [8, 11]] :
             [[5, 5], [11, 5], [5, 11], [11, 11]];
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      {dots.map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r={DOT_R} />)}
    </svg>
  );
}

function LayersIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 5.5L8 2l6.5 3.5L8 9 1.5 5.5z" />
      <path d="M1.5 10L8 13.5 14.5 10" />
    </svg>
  );
}

interface BatchSizeSelectorProps {
  dropdown?: boolean;
}

export default function BatchSizeSelector({ dropdown }: BatchSizeSelectorProps) {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdown) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdown]);

  if (dropdown) {
    return (
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary hover:bg-white/[0.06]"
        >
          <LayersIcon size={14} />
          <span>{state.batchSize}</span>
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: 4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full left-0 z-[60] mb-2 w-32 glass-heavy rounded-xl py-1.5"
            >
              <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-text-secondary/50">
                Batch Size
              </div>
              {([1, 2, 3, 4] as BatchSize[]).map((n) => (
                <button
                  key={n}
                  onClick={() => { dispatch({ type: "SET_BATCH_SIZE", payload: n }); setOpen(false); }}
                  className="flex w-full items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.06]"
                >
                  <span className={`${state.batchSize === n ? "text-text-primary" : "text-text-secondary/50"}`}>
                    <BatchDots n={n} />
                  </span>
                  <span className={`text-sm ${state.batchSize === n ? "text-text-primary font-medium" : "text-text-secondary"}`}>
                    {n}
                  </span>
                  {state.batchSize === n && <Check size={12} className="ml-auto text-accent" />}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const decrement = () => {
    if (state.batchSize > 1) dispatch({ type: "SET_BATCH_SIZE", payload: (state.batchSize - 1) as BatchSize });
  };
  const increment = () => {
    if (state.batchSize < 4) dispatch({ type: "SET_BATCH_SIZE", payload: (state.batchSize + 1) as BatchSize });
  };

  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={decrement}
        disabled={state.batchSize <= 1}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:text-text-primary hover:bg-white/[0.06] disabled:opacity-25 disabled:cursor-not-allowed"
      >
        <Minus size={14} />
      </button>
      <span className="min-w-[36px] text-center text-sm font-medium text-text-secondary tabular-nums">
        {state.batchSize}/4
      </span>
      <button
        onClick={increment}
        disabled={state.batchSize >= 4}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:text-text-primary hover:bg-white/[0.06] disabled:opacity-25 disabled:cursor-not-allowed"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
