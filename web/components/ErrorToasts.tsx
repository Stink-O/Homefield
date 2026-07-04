"use client";

import { useState, useCallback } from "react";
import { randomUUID } from "@/lib/uuid";

export interface ErrorToast {
  id: string;
  message: string;
}

// Transient error toasts that auto-dismiss after 6 seconds.
export function useErrorToasts() {
  const [errorToasts, setErrorToasts] = useState<ErrorToast[]>([]);

  const pushErrorToast = useCallback((message: string) => {
    const id = randomUUID();
    setErrorToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setErrorToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
  }, []);

  const dismissErrorToast = useCallback((id: string) => {
    setErrorToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { errorToasts, pushErrorToast, dismissErrorToast };
}

export default function ErrorToasts({ toasts, onDismiss }: { toasts: ErrorToast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed top-4 right-4 z-[300] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-3 rounded-xl border border-red-500/30 bg-surface/95 backdrop-blur px-4 py-3 shadow-lg max-w-xs"
        >
          <div className="h-2 w-2 rounded-full bg-red-400 flex-shrink-0" />
          <span className="text-xs text-text-secondary leading-snug">{toast.message}</span>
          <button
            onClick={() => onDismiss(toast.id)}
            className="ml-auto text-text-secondary/50 hover:text-text-primary transition-colors text-xs pl-2"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
