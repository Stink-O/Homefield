"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronRight } from "lucide-react";
import { useApp } from "@/contexts/AppContext";
import { MODELS, type ModelId } from "@/lib/types";

// Google "G" logo mark as SVG
function GoogleMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export default function ModelToggle() {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const activeModel = MODELS.find((m) => m.id === state.selectedModel)!;

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
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary hover:bg-white/[0.06]"
      >
        <GoogleMark size={14} />
        <span className="text-text-primary">{activeModel.label}</span>
        <ChevronRight
          size={14}
          className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 z-[60] mb-2 w-72 glass-heavy rounded-2xl py-2"
          >
            <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">
              Models
            </div>

            {MODELS.map((model) => {
              const isActive = state.selectedModel === model.id;
              return (
                <button
                  key={model.id}
                  onClick={() => {
                    dispatch({
                      type: "SET_MODEL",
                      payload: model.id as ModelId,
                    });
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.05] ${
                    isActive ? "bg-white/[0.03]" : ""
                  }`}
                >
                  {/* Icon */}
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06]">
                    <GoogleMark size={18} />
                  </div>

                  {/* Labels */}
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-semibold ${
                          isActive ? "text-text-primary" : "text-text-secondary"
                        }`}
                      >
                        {model.label}
                      </span>
                      {model.badge && (
                        <span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent">
                          {model.badge}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-text-secondary/60">
                      {model.description}
                    </p>
                  </div>

                  {/* Checkmark */}
                  {isActive && (
                    <Check size={15} className="shrink-0 text-accent" />
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
