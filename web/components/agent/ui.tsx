"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, Info } from "lucide-react";
import { copyText } from "@/lib/uuid";
import { AGENT_SELECTED, AGENT_UNSELECTED, AGENT_TEXT } from "./agentTheme";

/** Title + one line of plain explanation at the top of every step. */
export function StepHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-5">
      <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
      <p className="mt-1 text-sm text-text-secondary leading-relaxed">{description}</p>
    </div>
  );
}

export function TextField({
  label, value, onChange, placeholder, hint, maxLength = 64,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wider text-text-secondary/50">{label}</span>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full rounded-xl border border-[var(--border)] bg-white/[0.03] px-3 py-2.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-secondary/40 focus:border-accent/50"
      />
      {hint && <span className="mt-2 block text-xs text-text-secondary/50">{hint}</span>}
    </label>
  );
}

/** A radio-style card. One of a set; the chosen one carries the accent tint. */
export function OptionCard({
  selected, onClick, title, description, children,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-3 transition-colors ${selected ? AGENT_SELECTED : AGENT_UNSELECTED}`}
    >
      <button type="button" onClick={onClick} className="flex w-full items-start gap-3 text-left">
        <span
          className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
            selected ? "border-accent bg-accent" : "border-[var(--chrome-border-strong)]"
          }`}
        >
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-black" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-text-primary">{title}</span>
          <span className="mt-0.5 block text-xs text-text-secondary/70 leading-relaxed">{description}</span>
        </span>
      </button>
      {selected && children && <div className="mt-3 pl-7">{children}</div>}
    </div>
  );
}

/** A checkbox row, with an optional line of consequence for the risky ones. */
export function CheckOption({
  checked, onChange, title, description, warning,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  description: string;
  warning?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
        checked ? AGENT_SELECTED : AGENT_UNSELECTED
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
          checked ? "border-accent bg-accent" : "border-[var(--chrome-border-strong)]"
        }`}
      >
        {checked && <Check size={11} className="text-black" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-text-primary">{title}</span>
        <span className="mt-0.5 block text-xs text-text-secondary/70 leading-relaxed">{description}</span>
        {warning && (
          <span className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-500 leading-relaxed">
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
            {warning}
          </span>
        )}
      </span>
    </button>
  );
}

/** Small segmented picker used for the model and quality ceilings. */
export function SegmentedRow<T extends string>({
  label, options, value, onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-text-secondary/50">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
              value === opt.id ? AGENT_SELECTED : AGENT_UNSELECTED
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Monospace block with a copy button — commands, URLs, and the token itself. */
export function CopyBlock({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await copyText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div>
      {label && <p className="mb-2 text-xs font-medium uppercase tracking-wider text-text-secondary/50">{label}</p>}
      <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-white/[0.03] p-3">
        <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-text-primary">
          {value}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className={`flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors ${
            copied ? `bg-accent/15 ${AGENT_TEXT}` : "bg-[var(--border)] text-text-secondary hover:text-text-primary"
          }`}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/** A plainly-worded note. "warn" for anything that can lose or leak data. */
export function Callout({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  const warn = tone === "warn";
  return (
    <div
      className={`flex items-start gap-2 rounded-xl border p-3 text-xs leading-relaxed ${
        warn
          ? "border-amber-500/25 bg-amber-500/10 text-amber-500"
          : "border-[var(--border)] bg-white/[0.03] text-text-secondary"
      }`}
    >
      {warn ? <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> : <Info size={13} className="mt-0.5 flex-shrink-0" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Relative time for "last used" readouts. */
export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
