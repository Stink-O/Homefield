"use client";

import { memo, useRef } from "react";
import { Heart, Trash2 } from "lucide-react";
import { type UserTemplate } from "@/lib/storage";
import type { TemplatePrompt } from "./constants";

export function ShimmerCard() {
  return (
    <div className="rounded-xl border border-[var(--chrome-border)] bg-[var(--chrome-surface)] overflow-hidden animate-pulse">
      <div className="aspect-[3/2] bg-[var(--chrome-surface-hover)]" />
      <div className="p-3 space-y-2">
        <div className="h-4 bg-[var(--chrome-surface-hover)] rounded w-3/4" />
        <div className="h-3 bg-[var(--chrome-surface)] rounded w-full" />
        <div className="h-3 bg-[var(--chrome-surface)] rounded w-5/6" />
        <div className="h-7 bg-[var(--chrome-surface-hover)] rounded-lg mt-3" />
      </div>
    </div>
  );
}

export const PromptCard = memo(function PromptCard({
  prompt,
  isFavorited,
  onSelect,
  onToggleFavorite,
  onImageError,
}: {
  prompt: TemplatePrompt;
  isFavorited: boolean;
  onSelect: (rect: DOMRect) => void;
  onToggleFavorite: () => void;
  onImageError: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const fire = () => { if (btnRef.current) onSelect(btnRef.current.getBoundingClientRect()); };

  return (
    <div
      className="group rounded-xl border border-[var(--chrome-border)] bg-[var(--chrome-surface)] overflow-hidden cursor-pointer hover:border-[var(--chrome-border-strong)] hover:bg-[var(--chrome-surface-hover)] transition-colors duration-150"
      style={{ contentVisibility: "auto", containIntrinsicSize: "0 220px" }}
      onClick={fire}
    >
      <div className="relative">
        {prompt.thumbnail && (
          <div className="aspect-[3/2] bg-black/20 overflow-hidden">
            <img
              src={prompt.thumbnail}
              alt=""
              loading="lazy"
              decoding="async"
              onError={onImageError}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          </div>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          className={`absolute top-2 right-2 flex items-center justify-center w-7 h-7 rounded-lg transition-colors duration-150 ${
            isFavorited
              ? "bg-red-500/90 text-white"
              : "bg-black/40 text-white/40 opacity-0 group-hover:opacity-100 hover:text-white hover:bg-black/60"
          }`}
          aria-label={isFavorited ? "Remove from favourites" : "Add to favourites"}
        >
          <Heart size={13} fill={isFavorited ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="p-3 flex flex-col gap-1.5">
        <h3
          className="text-sm font-semibold text-text-primary leading-snug"
          style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          {prompt.title}
        </h3>
        <p
          className="text-xs text-text-secondary leading-relaxed"
          style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          {prompt.description}
        </p>
        <p className="text-[11px] text-text-secondary/60">by {prompt.author}</p>
        <button
          ref={btnRef}
          onClick={(e) => { e.stopPropagation(); fire(); }}
          className="mt-1 w-full rounded-lg bg-[#a3e635] text-black font-semibold px-3 py-1.5 text-sm hover:bg-[#bef264] transition-colors duration-150"
        >
          Use Prompt
        </button>
      </div>
    </div>
  );
});

export const MineCard = memo(function MineCard({
  template,
  onSelect,
  onDelete,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  template: UserTemplate;
  onSelect: (rect: DOMRect) => void;
  onDelete: () => void;
  confirmingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const fire = () => { if (btnRef.current) onSelect(btnRef.current.getBoundingClientRect()); };

  return (
    <div
      className="group rounded-xl border border-[var(--chrome-border)] bg-[var(--chrome-surface)] overflow-hidden cursor-pointer hover:border-[var(--chrome-border-strong)] hover:bg-[var(--chrome-surface-hover)] transition-colors duration-150"
      onClick={fire}
    >
      <div className="relative">
        <div
          className="aspect-[3/2] bg-black/20"
          style={{ backgroundImage: `url(${template.thumbnail})`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center" }}
        />
        {confirmingDelete ? (
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-2">
            <p className="text-xs text-white/80 font-medium">Delete this template?</p>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); onConfirmDelete(); }}
                className="rounded-lg bg-red-500 hover:bg-red-400 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
              >
                Delete
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onCancelDelete(); }}
                className="rounded-lg bg-[var(--chrome-surface-hover)] hover:bg-[var(--chrome-surface-hover)] px-3 py-1.5 text-xs font-semibold text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="absolute top-2 right-2 flex items-center justify-center w-7 h-7 rounded-lg bg-black/40 text-white/40 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-black/60 transition-colors duration-150"
            aria-label="Delete template"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <div className="p-3 flex flex-col gap-1.5">
        <h3
          className="text-sm font-semibold text-text-primary leading-snug"
          style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          {template.title}
        </h3>
        {template.description && (
          <p
            className="text-xs text-text-secondary leading-relaxed"
            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          >
            {template.description}
          </p>
        )}
        <p className="text-[11px] text-text-secondary/60">{new Date(template.createdAt).toLocaleDateString()}</p>
        <button
          ref={btnRef}
          onClick={(e) => { e.stopPropagation(); fire(); }}
          className="mt-1 w-full rounded-lg bg-[#a3e635] text-black font-semibold px-3 py-1.5 text-sm hover:bg-[#bef264] transition-colors duration-150"
        >
          Use Prompt
        </button>
      </div>
    </div>
  );
});
