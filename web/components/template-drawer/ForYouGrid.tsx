"use client";

import { Sparkles } from "lucide-react";
import { ShimmerCard, PromptCard } from "./cards";
import type { TemplatePrompt } from "./constants";

export default function ForYouGrid({
  loading,
  error,
  results,
  favorites,
  failedImageIds,
  onSelect,
  onToggleFavorite,
  onImageError,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  results: TemplatePrompt[];
  favorites: Record<string, TemplatePrompt>;
  failedImageIds: Set<string>;
  onSelect: (content: string, rect: DOMRect) => void;
  onToggleFavorite: (prompt: TemplatePrompt) => void;
  onImageError: (id: string) => void;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 12 }).map((_, i) => <ShimmerCard key={i} />)}
      </div>
    );
  }

  if (error === "not-enough") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-20">
        <Sparkles size={32} className="text-text-secondary/20 mb-3" />
        <p className="text-text-secondary text-sm">Not enough history yet</p>
        <p className="text-text-secondary/40 text-xs mt-1">Generate a few images first — suggestions will appear here</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-20">
        <p className="text-text-secondary text-sm">Could not load suggestions</p>
        <p className="text-text-secondary/40 text-xs mt-1 max-w-xs">{error}</p>
        <button
          onClick={onRetry}
          className="mt-3 text-xs text-text-secondary/50 hover:text-text-secondary transition-colors underline underline-offset-2"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {results.filter((p) => !!p.thumbnail && !failedImageIds.has(p.id)).map((prompt) => (
        <PromptCard
          key={prompt.id}
          prompt={prompt}
          isFavorited={!!favorites[prompt.id]}
          onSelect={(rect) => onSelect(prompt.content, rect)}
          onToggleFavorite={() => onToggleFavorite(prompt)}
          onImageError={() => onImageError(prompt.id)}
        />
      ))}
    </div>
  );
}
