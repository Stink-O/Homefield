"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp } from "lucide-react";

export default function ScrollTopButton({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="scroll-top"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          whileHover={{ scale: 1.05 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="fixed top-[70px] left-1/2 -translate-x-1/2 z-[150] p-[2px] rounded-2xl overflow-hidden"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            style={{
              position: "absolute",
              width: "200%",
              height: "200%",
              top: "-50%",
              left: "-50%",
              background: "conic-gradient(from 0deg, transparent 0%, transparent 50%, rgba(163,230,53,0.4) 65%, rgba(163,230,53,1) 75%, rgba(163,230,53,0.4) 85%, transparent 100%)",
            }}
          />
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="relative glass-command flex items-center justify-center rounded-[14px] w-10 h-10 text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
            aria-label="Scroll to top"
          >
            <ChevronUp size={17} strokeWidth={2.5} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
