"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ExternalLink } from "lucide-react";

/**
 * The "where do I get a key" walkthrough. Shared by the instance-key flow and
 * the per-user flow — a user told to bring their own key needs this guidance
 * more than the admin does.
 */
export default function SetupGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-5 border-t border-[var(--border)] pt-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm text-text-primary">Don&apos;t have a key? Get $300 free credit</span>
        <ChevronDown
          size={15}
          className="text-text-secondary/40 transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <ol className="mt-3 space-y-2 text-xs text-text-secondary/70 leading-relaxed list-decimal pl-4">
              <li>Start a free Google Cloud trial to get $300 in credit.</li>
              <li>Create a project and enable the Vertex AI API.</li>
              <li>Create a service account, then add a JSON key.</li>
              <li>Download the key file and upload it above.</li>
            </ol>
            <a
              href="https://cloud.google.com/free"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
            >
              Open Google Cloud free trial <ExternalLink size={12} />
            </a>
            <p className="mt-2 text-[11px] text-text-secondary/40">
              A full step-by-step walkthrough is coming soon.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
