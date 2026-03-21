"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
import { useApp } from "@/contexts/AppContext";
import { QUALITIES, type Quality } from "@/lib/types";

export default function QualitySelector() {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary hover:bg-white/[0.06]"
      >
        <span>{state.quality}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 z-[60] mb-2 w-36 glass-heavy rounded-xl py-1.5"
          >
            <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-text-secondary/50">
              Quality
            </div>
            {QUALITIES.map((q) => (
              <button
                key={q.id}
                onClick={() => {
                  dispatch({ type: "SET_QUALITY", payload: q.id as Quality });
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-white/[0.06]"
              >
                <span
                  className={
                    state.quality === q.id
                      ? "text-text-primary font-medium"
                      : "text-text-secondary"
                  }
                >
                  {q.label}
                </span>
                <span className="ml-auto">
                  {state.quality === q.id && (
                    <Check size={12} className="text-accent" />
                  )}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
