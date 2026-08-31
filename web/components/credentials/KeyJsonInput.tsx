"use client";

import { useRef } from "react";
import { Upload } from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Small caps label above the field. */
  label: string;
  disabled?: boolean;
}

/**
 * The paste-or-upload affordance for a service-account JSON key. Lifted out of
 * CredentialModal unchanged so the instance key and a user's own key are added
 * through exactly the same control.
 */
export default function KeyJsonInput({ value, onChange, label, disabled = false }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(file);
  };

  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wider text-text-secondary/50 mb-2">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        spellCheck={false}
        placeholder={'{\n  "type": "service_account",\n  "project_id": "...",\n  ...\n}'}
        className="w-full h-32 resize-none rounded-xl bg-white/[0.03] border border-[var(--border)] px-3.5 py-3 font-mono text-xs text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-accent/40 transition-colors disabled:opacity-50"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--border)] px-3 py-2 text-xs text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
        >
          <Upload size={13} /> Upload .json
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFile} />
        <span className="text-xs text-text-secondary/40">Pasted keys never leave this server.</span>
      </div>
    </div>
  );
}
