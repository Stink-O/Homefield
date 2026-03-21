"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Trash2 } from "lucide-react";

interface DeleteConfirmModalProps {
  open: boolean;
  count?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteConfirmModal({ open, count = 1, onConfirm, onCancel }: DeleteConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[500] bg-black/60 backdrop-blur-sm"
            onClick={onCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
            className="fixed inset-0 z-[501] flex items-center justify-center pointer-events-none p-4"
          >
            <div className="pointer-events-auto glass rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-[var(--border)]">
              <div className="flex items-center gap-3 mb-1">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/15">
                  <Trash2 size={16} className="text-red-400" />
                </div>
                <h2 className="text-base font-semibold text-text-primary">
                  Delete {count === 1 ? "image" : `${count} images`}?
                </h2>
              </div>
              <p className="mt-1 mb-5 text-sm text-text-secondary/60 pl-12">
                This cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={onCancel}
                  className="rounded-xl px-4 py-2 text-sm font-medium text-text-secondary bg-[var(--border)] hover:text-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={onConfirm}
                  className="rounded-xl px-4 py-2 text-sm font-semibold text-white bg-red-500/80 hover:bg-red-500 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
