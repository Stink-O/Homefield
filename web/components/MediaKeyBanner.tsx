"use client";

import { motion, AnimatePresence } from "framer-motion";
import { KeyRound, ArrowRight } from "lucide-react";
import { useSession } from "next-auth/react";
import { useApp } from "@/contexts/AppContext";

// Slim bar docked directly under the header while no media-generation key is
// configured. Anchored (not floating) so it reads as a system status. The
// Gallery adds matching top padding (see its outer container) so content is
// pushed down rather than overlapped. Hidden once a key is set.
export default function MediaKeyBanner() {
  const { state, dispatch } = useApp();
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";

  const show = state.mediaKeyConfigured === false;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="media-key-bar"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ type: "spring", damping: 28, stiffness: 320 }}
          className="fixed left-0 right-0 top-14 sm:top-16 z-40 flex h-12 items-center gap-2.5 px-4 sm:px-6 backdrop-blur-md"
          style={{ background: "linear-gradient(180deg, rgba(163,230,53,0.10), rgba(163,230,53,0.05))" }}
        >
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-accent/20">
            <KeyRound size={13} className="text-accent" />
          </span>
          <p className="truncate text-xs sm:text-sm">
            <span className="font-medium text-text-primary">
              {isAdmin ? "Media generation needs a Google key" : "Media generation needs a Google key from your admin"}
            </span>
            {isAdmin && (
              <span className="hidden text-text-secondary/60 sm:inline">{"  ·  Add one to start creating images and music"}</span>
            )}
          </p>
          {isAdmin && (
            <button
              onClick={() => dispatch({ type: "OPEN_CREDENTIAL_MODAL" })}
              className="ml-auto flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-accent-hover"
            >
              Add key <ArrowRight size={13} />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
