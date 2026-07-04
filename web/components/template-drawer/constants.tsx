import React from "react";
import { Heart, User, Sparkles } from "lucide-react";

export interface TemplatePrompt {
  id: string;
  title: string;
  description: string;
  content: string;
  author: string;
  thumbnail: string | null;
  category: "json" | "portrait" | "product" | "character" | "international" | "general";
  subcategory: string | null;
}

export interface TemplatesResponse {
  prompts: TemplatePrompt[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  categoryCounts: Record<string, number>;
  subcategoryCounts: Record<string, number>;
}

export type CategoryKey = "for-you" | "mine" | "favorites" | "all" | "json" | "portrait" | "product" | "character" | "international" | "general";

export const CATEGORIES: { label: string; value: CategoryKey; icon?: React.ReactNode }[] = [
  { label: "For You",                 value: "for-you",       icon: <Sparkles size={13} /> },
  { label: "Mine",                    value: "mine",          icon: <User size={13} /> },
  { label: "Favorites",              value: "favorites",     icon: <Heart size={13} /> },
  { label: "All",                    value: "all" },
  { label: "JSON Structures",        value: "json" },
  { label: "Portraits / Lifestyle",  value: "portrait" },
  { label: "Products / Concept Art", value: "product" },
  { label: "Character & Illustration", value: "character" },
  { label: "International",          value: "international" },
  { label: "General",                value: "general" },
];

export const SUBCATEGORY_LABELS: Record<string, Record<string, string>> = {
  portrait: {
    selfies:   "Selfies",   editorial: "Editorial", fashion:  "Fashion",
    glamour:   "Glamour",   headshots: "Headshots", beauty:   "Beauty",
    lifestyle: "Lifestyle", other:     "Other",
  },
  character: {
    anime:              "Anime",       cartoon:    "Cartoon",      "character-design": "Character Design",
    illustration:       "Illustration", creature:  "Creature",     fantasy:            "Fantasy",
    "hero-villain":     "Hero & Villain", other:  "Other",
  },
  product: {
    "food-macro": "Food & Macro", architecture: "Architecture", miniature: "Miniature & Diorama",
    vehicles:     "Vehicles",     vintage:      "Vintage",      "3d-render": "3D Render",
    other:        "Other",
  },
  general: {
    cinematic:           "Cinematic",         surreal:             "Surreal",
    "poster-collage":    "Poster & Collage",  "urban-street":      "Urban & Street",
    "vintage-aesthetic": "Vintage & Aesthetic", other:             "Other",
  },
};

export const HAS_SUBCATEGORIES = new Set(["portrait", "character", "product", "general"]);
export const FAVORITES_KEY = "template_favorites";

export function loadFavoritesFromStorage(): Record<string, TemplatePrompt> {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "{}"); }
  catch { return {}; }
}

export function saveFavoritesToStorage(favs: Record<string, TemplatePrompt>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
}

// Resize image to at most MAX_PX on the longest side, output as JPEG @ 85%.
export function processImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const MAX = 900;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = dataUrl;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
