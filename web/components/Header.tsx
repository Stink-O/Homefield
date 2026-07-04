"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Settings, BookOpen, LogOut, Lock, Globe, MoreVertical } from "lucide-react";
import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import { useApp } from "@/contexts/AppContext";
import WorkspaceMenu from "./header/WorkspaceMenu";
import type { RowHeightIndex } from "@/lib/types";

interface HeaderProps {
  onOpenTemplate?: () => void;
  isSharedMode?: boolean;
  promptSetterRef?: React.RefObject<((p: string) => void) | null>;
  onPromptSelect?: (p: string) => void;
}

export default function Header({ onOpenTemplate, isSharedMode }: HeaderProps) {
  const { state, dispatch } = useApp();
  const { data: session } = useSession();
  const [sliderValue, setSliderValue] = useState(state.rowHeightIndex);
  const [, startTransition] = useTransition();

  const username = session?.user?.name ?? "";
  const userRole = (session?.user as { role?: string } | undefined)?.role ?? "";

  // Pending registration count for admin notification badge
  const [pendingCount, setPendingCount] = useState(0);
  const fetchPending = useCallback(() => {
    if (userRole !== "admin") return;
    fetch("/api/admin/pending-count")
      .then((r) => r.ok ? r.json() : { count: 0 })
      .then(({ count }) => setPendingCount(count))
      .catch(() => {});
  }, [userRole]);
  useEffect(() => {
    fetchPending();
    const interval = setInterval(fetchPending, 30_000);
    return () => clearInterval(interval);
  }, [fetchPending]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value) as RowHeightIndex;
    setSliderValue(value);
    startTransition(() => {
      dispatch({ type: "SET_ROW_HEIGHT", payload: value });
    });
  };

  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const mobileMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mobileMoreOpen) return;
    function handleClick(e: MouseEvent) {
      if (mobileMoreRef.current && !mobileMoreRef.current.contains(e.target as Node)) {
        setMobileMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [mobileMoreOpen]);

  return (
    <>
    <style>{`
      @keyframes liveDot {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.25; transform: scale(0.7); }
      }
    `}</style>
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--border)]"
      style={{ background: "var(--surface)" }}
      suppressHydrationWarning
    >
      <div className="flex h-14 sm:h-16 items-center px-4 sm:px-6">

        {/* Left: Logo + workspace OR shared label */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Image
            src="/logo-header.png"
            alt="HomeField"
            width={52}
            height={52}
            className="rounded-xl w-9 h-9 sm:w-[52px] sm:h-[52px] shrink-0"
          />
          <span className="hidden lg:inline text-xl font-bold tracking-tight text-text-primary">
            HomeField
          </span>
          <span className="hidden xl:inline-block text-[11px] font-medium uppercase tracking-widest text-text-secondary">
            Studio
          </span>

          {/* Workspace dropdown — private mode only */}
          {!isSharedMode && <WorkspaceMenu />}

          {/* Shared space label */}
          {isSharedMode && (
            <div className="ml-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 sm:px-3 bg-amber-500/12 border border-amber-500/25">
              <span
                className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
                style={{ animation: "liveDot 2.4s ease-in-out infinite" }}
              />
              <span className="text-sm font-medium text-amber-500 hidden sm:inline">Shared Space</span>
              <span className="text-sm font-medium text-amber-500 sm:hidden">Shared</span>
            </div>
          )}
        </div>

        {/* Left spacer */}
        <div className="flex-1" />

        {/* Center: mode toggle + templates */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Compact icon toggle — below lg */}
          <div className="lg:hidden flex items-center rounded-lg border border-[var(--border)] overflow-hidden" suppressHydrationWarning>
            <Link
              href="/"
              className={`flex items-center justify-center h-8 w-8 transition-all ${
                !isSharedMode ? "bg-[var(--border)] text-text-primary" : "text-text-secondary/40 hover:text-text-secondary"
              }`}
              title="Private"
            >
              <Lock size={13} />
            </Link>
            <Link
              href="/shared"
              className={`flex items-center justify-center h-8 w-8 transition-all ${
                isSharedMode ? "bg-amber-500/15 text-amber-500" : "text-text-secondary/40 hover:text-text-secondary"
              }`}
              title="Shared"
            >
              <Globe size={13} />
            </Link>
          </div>

          {/* Template icon — xs only (mobile) */}
          {onOpenTemplate && (
            <button
              onClick={onOpenTemplate}
              className="sm:hidden relative flex items-center justify-center h-9 w-9 rounded-xl text-text-secondary transition-colors hover:text-text-primary"
              aria-label="Templates"
            >
              <BookOpen size={18} />
            </button>
          )}

          {/* Template full button — sm to lg */}
          {onOpenTemplate && (
            <button
              onClick={onOpenTemplate}
              className="hidden sm:flex lg:hidden items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium text-text-primary/80 transition-all duration-150 hover:text-text-primary hover:bg-[#a3e635]/8"
              style={{ border: "1px solid rgba(163,230,53,0.28)" }}
            >
              Templates
            </button>
          )}

          {/* Full text toggle + templates — lg+ */}
          <div className="hidden lg:flex items-center gap-1 rounded-xl p-1" style={{ background: "var(--chrome-surface)" }}>
            <Link
              href="/"
              className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all duration-150 ${
                !isSharedMode
                  ? "text-text-primary bg-[var(--border)]"
                  : "text-text-secondary/60 hover:text-text-secondary"
              }`}
            >
              <Lock size={11} />
              Private
            </Link>
            <Link
              href="/shared"
              className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all duration-150 ${
                isSharedMode
                  ? "text-amber-500 bg-amber-500/15"
                  : "text-text-secondary/60 hover:text-text-secondary hover:bg-amber-500/5"
              }`}
            >
              <Globe size={11} />
              Shared
            </Link>
            {onOpenTemplate && (
              <div className="flex items-center">
                <div className="w-px h-4 bg-[var(--border)] mx-1" />
                <button
                  onClick={onOpenTemplate}
                  className="flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium text-text-primary/80 transition-all duration-150 hover:text-text-primary hover:bg-[#a3e635]/8"
                  style={{ border: "1px solid rgba(163,230,53,0.28)" }}
                >
                  Templates
                </button>
              </div>
            )}
            <div className="flex items-center">
              <div className="w-px h-4 bg-[var(--border)] mx-1" />
              <Link
                href="/music"
                className="flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium text-text-secondary/60 transition-all duration-150 hover:text-text-secondary"
              >
                Music
              </Link>
            </div>
          </div>
        </div>

        {/* Right spacer */}
        <div className="flex-1" />

        {/* Right: controls + user */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Gallery size slider — lg+ */}
          <input
            type="range"
            min={0}
            max={4}
            step={1}
            value={sliderValue}
            onChange={handleSliderChange}
            className="gallery-slider w-24 hidden lg:block"
            title="Gallery size"
          />

          {/* User pill + sign-out — xl+ only */}
          {username && (
            <div className="hidden xl:flex items-center gap-2">
              {userRole === "admin" && (
                <Link
                  href="/admin"
                  className="relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-amber-400 bg-amber-400/10 border border-amber-400/25 hover:bg-amber-400/20 hover:border-amber-400/50 transition-all duration-150"
                  title="Admin panel"
                >
                  Admin
                  {pendingCount > 0 && (
                    <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-black leading-none shrink-0">
                      {pendingCount > 9 ? "9+" : pendingCount}
                    </span>
                  )}
                </Link>
              )}
              <Link
                href="/account"
                className="text-sm font-medium text-text-secondary/80 hover:text-text-primary transition-colors max-w-[120px] truncate"
                title="Account settings"
              >
                {username}
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex h-8 w-8 items-center justify-center rounded-xl text-text-secondary/60 transition-colors hover:text-red-400 hover:bg-red-500/8"
                title="Sign out"
              >
                <LogOut size={15} />
              </button>
            </div>
          )}

          {/* Settings button — always visible sm+ */}
          <motion.button
            whileHover={{ rotate: 90 }}
            transition={{ duration: 0.3 }}
            onClick={() => dispatch({ type: "TOGGLE_SETTINGS" })}
            className="hidden sm:flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl text-text-secondary transition-colors hover:text-text-primary"
          >
            <Settings size={20} />
          </motion.button>

          {/* Overflow more menu — visible below xl */}
          <div className="xl:hidden relative" ref={mobileMoreRef}>
            <button
              onClick={() => setMobileMoreOpen((v) => !v)}
              className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${mobileMoreOpen ? "bg-[var(--border)] text-text-primary" : "text-text-secondary hover:text-text-primary"}`}
              title="More"
            >
              {pendingCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
              )}
              <MoreVertical size={18} />
            </button>
            {mobileMoreOpen && (
              <div className="absolute right-0 top-full mt-1 z-[200] w-52 rounded-xl border border-[var(--border)] bg-surface-elevated shadow-xl py-1">
                <Link
                  href="/music"
                  onClick={() => setMobileMoreOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-text-primary hover:bg-[var(--border)] transition-colors"
                >
                  Music
                </Link>
                <button
                  onClick={() => { dispatch({ type: "TOGGLE_SETTINGS" }); setMobileMoreOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-text-primary hover:bg-[var(--border)] transition-colors"
                >
                  <Settings size={14} /> Settings
                </button>
                {userRole === "admin" && (
                  <Link
                    href="/admin"
                    onClick={() => setMobileMoreOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-amber-400 hover:bg-[var(--border)] transition-colors"
                  >
                    <span className="flex-1">Admin</span>
                    {pendingCount > 0 && (
                      <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-black leading-none shrink-0">
                        {pendingCount > 9 ? "9+" : pendingCount}
                      </span>
                    )}
                  </Link>
                )}
                {username && (
                  <Link
                    href="/account"
                    onClick={() => setMobileMoreOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-text-secondary hover:bg-[var(--border)] transition-colors"
                  >
                    <span className="truncate">{username}</span>
                  </Link>
                )}
                <div className="border-t border-[var(--border)] my-1" />
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-400 hover:bg-[var(--border)] transition-colors"
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.header>
    </>
  );
}
