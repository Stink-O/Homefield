"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "@/contexts/AppContext";
import { MODEL_ASPECT_RATIOS, type AspectRatio } from "@/lib/types";

// Fixed 14×10 bounding box so extreme ratios (8:1, 21:9) don't collapse to
// indistinguishable slivers — the rectangle scales to fit within the box.
function RatioIcon({ ratio }: { ratio: AspectRatio }) {
  if (ratio === "Auto") return null;
  const [w, h] = ratio.split(":").map(Number);
  const BOX_W = 14;
  const BOX_H = 10;
  const scale = Math.min(BOX_W / w, BOX_H / h);
  const width = Math.max(Math.round(w * scale), 2);
  const height = Math.max(Math.round(h * scale), 2);
  return (
    <div className="flex items-center justify-center shrink-0" style={{ width: BOX_W, height: BOX_H }}>
      <div
        className="rounded-[1.5px] border border-current opacity-60"
        style={{ width, height }}
      />
    </div>
  );
}

export default function AspectRatioSelector() {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const supportedRatios = MODEL_ASPECT_RATIOS[state.selectedModel];

  // If the active ratio isn't supported by the current model, reset to Auto.
  useEffect(() => {
    if (!supportedRatios.includes(state.aspectRatio)) {
      dispatch({ type: "SET_ASPECT_RATIO", payload: "Auto" });
    }
  }, [state.selectedModel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const [autoRatio, ...rest] = supportedRatios;

  const renderBtn = (ratio: AspectRatio) => {
    const selected = state.aspectRatio === ratio;
    return (
      <button
        key={ratio}
        onClick={() => {
          dispatch({ type: "SET_ASPECT_RATIO", payload: ratio });
          setOpen(false);
        }}
        className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
          selected
            ? "bg-accent/15 text-accent border border-accent/25"
            : "bg-white/[0.05] text-text-secondary border border-transparent hover:bg-white/[0.08] hover:text-text-primary"
        }`}
      >
        {ratio === "Auto"
          ? <span className="text-[9px] font-bold opacity-70">A</span>
          : <RatioIcon ratio={ratio} />
        }
        {ratio}
      </button>
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary hover:bg-white/[0.06]"
      >
        <RatioIcon ratio={state.aspectRatio} />
        <span>{state.aspectRatio}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 z-[60] mb-2 w-56 glass-heavy rounded-xl p-2.5"
          >
            <div className="px-1 pb-2 text-[10px] font-medium uppercase tracking-wider text-text-secondary/50">
              Aspect Ratio
            </div>
            {/* Auto spans the full width; remaining ratios fill a 3-col grid */}
            <div className="grid grid-cols-3 gap-1.5">
              <div className="col-span-3">{renderBtn(autoRatio)}</div>
              {rest.map((r) => renderBtn(r))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
