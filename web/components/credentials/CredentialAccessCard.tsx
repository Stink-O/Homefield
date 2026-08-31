"use client";

import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Ban, KeyRound, ShieldCheck } from "lucide-react";
import { useOwnCredentials, type OwnCredentialStatus } from "./useOwnCredentials";

interface Props {
  isAdmin: boolean;
  /** Whether the INSTANCE key is configured (state.mediaKeyConfigured). */
  keyConfigured: boolean;
  onManage: () => void;
}

type Tone = "ok" | "warn" | "off" | "idle";

interface CardView {
  tone: Tone;
  Icon: LucideIcon;
  title: string;
  subtitle: string;
  /** Omitted when there is genuinely nothing for this viewer to manage. */
  action?: string;
}

const TONE_ICON: Record<Tone, string> = {
  ok: "bg-accent/15 text-accent",
  warn: "bg-amber-500/15 text-amber-400",
  off: "bg-red-500/15 text-red-400",
  idle: "bg-[var(--border)] text-text-secondary",
};

/** What the signed-in user sees about their own generation credentials. */
function ownView(status: OwnCredentialStatus): CardView {
  if (status.access === "none") {
    return {
      tone: "off",
      Icon: Ban,
      title: "Generation is turned off",
      subtitle: "Ask an administrator of this instance to restore your access.",
    };
  }
  if (status.hasOwnKey) {
    return {
      tone: "ok",
      Icon: ShieldCheck,
      title: "Using your own Google key",
      subtitle: status.clientEmail ?? "Generations bill to your own Google project",
      action: "Manage",
    };
  }
  if (status.access === "own") {
    return {
      tone: "warn",
      Icon: AlertTriangle,
      title: "Your Google key is missing",
      subtitle: "You cannot generate until you add your own service-account key.",
      action: "Add key",
    };
  }
  return {
    tone: "idle",
    Icon: KeyRound,
    title: "Using the instance key",
    subtitle: status.canGenerate
      ? "Generations are billed to this instance's Google project"
      : "No instance key is connected yet — ask an administrator",
    action: "View",
  };
}

function adminView(keyConfigured: boolean): CardView {
  return {
    tone: keyConfigured ? "ok" : "idle",
    Icon: keyConfigured ? ShieldCheck : KeyRound,
    title: keyConfigured ? "Google Cloud connected" : "No key connected",
    subtitle: keyConfigured ? "Image and music generation enabled" : "Required for media generation",
    action: keyConfigured ? "Manage" : "Add key",
  };
}

function Card({ view, onManage }: { view: CardView; onManage: () => void }) {
  const { Icon } = view;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/[0.03] p-3">
      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${TONE_ICON[view.tone]}`}>
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text-primary">{view.title}</p>
        <p className="truncate text-xs text-text-secondary/50">{view.subtitle}</p>
      </div>
      {view.action && (
        <button
          onClick={onManage}
          className="flex-shrink-0 rounded-lg bg-[var(--border)] px-3 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary"
        >
          {view.action}
        </button>
      )}
    </div>
  );
}

/**
 * The settings entry point for generation credentials, shown to everyone.
 *
 * An admin sees the instance key they are responsible for; a user sees the tier
 * an admin put them on and whether they can generate. An admin who is also on a
 * non-default tier sees both, because both decide whether THEY can generate.
 */
export default function CredentialAccessCard({ isAdmin, keyConfigured, onManage }: Props) {
  const { status, loading } = useOwnCredentials();

  if (loading && !status) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/[0.03] p-3">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--border)]">
          <KeyRound size={15} className="text-text-secondary" />
        </span>
        <p className="text-sm text-text-secondary/50">Checking generation access…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return status ? <Card view={ownView(status)} onManage={onManage} /> : null;
  }

  // An admin's own tier only matters when it is not the plain default.
  const showOwn = !!status && (status.access !== "shared" || status.hasOwnKey);

  return (
    <div className="space-y-2">
      <Card view={adminView(keyConfigured)} onManage={onManage} />
      {showOwn && status && <Card view={ownView(status)} onManage={onManage} />}
    </div>
  );
}
