"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Search, ChevronRight, Heart, User, Plus, Trash2, Upload, ArrowLeft, Sparkles, RefreshCw } from "lucide-react";
import { type UserTemplate } from "@/lib/storage";

interface TemplatePrompt {
  id: string;
  title: string;
  description: string;
  content: string;
  author: string;
  thumbnail: string | null;
  category: "json" | "portrait" | "product" | "character" | "international" | "general";
  subcategory: string | null;
}

interface TemplatesResponse {
  prompts: TemplatePrompt[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  categoryCounts: Record<string, number>;
  subcategoryCounts: Record<string, number>;
}

interface TemplateDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelectPrompt: (content: string, sourceRect: DOMRect) => void;
}

type CategoryKey = "for-you" | "mine" | "favorites" | "all" | "json" | "portrait" | "product" | "character" | "international" | "general";

const CATEGORIES: { label: string; value: CategoryKey; icon?: React.ReactNode }[] = [
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

const SUBCATEGORY_LABELS: Record<string, Record<string, string>> = {
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

const HAS_SUBCATEGORIES = new Set(["portrait", "character", "product", "general"]);
const FAVORITES_KEY = "template_favorites";

function loadFavoritesFromStorage(): Record<string, TemplatePrompt> {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "{}"); }
  catch { return {}; }
}

function saveFavoritesToStorage(favs: Record<string, TemplatePrompt>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
}

// Resize image to at most MAX_PX on the longest side, output as JPEG @ 85%.
function processImageFile(file: File): Promise<string> {
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

function ShimmerCard() {
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

const PromptCard = memo(function PromptCard({
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

const MineCard = memo(function MineCard({
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

export default function TemplateDrawer({ open, onClose, onSelectPrompt }: TemplateDrawerProps) {
  const [category, setCategory]               = useState<CategoryKey>("for-you");
  const [subcategory, setSubcategory]         = useState<string>("all");
  const [search, setSearch]                   = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage]                       = useState(0);
  const [prompts, setPrompts]                 = useState<TemplatePrompt[]>([]);
  const [total, setTotal]                     = useState(0);
  const [hasMore, setHasMore]                 = useState(false);
  const [categoryCounts, setCategoryCounts]   = useState<Record<string, number>>({});
  const [subcategoryCounts, setSubcategoryCounts] = useState<Record<string, number>>({});
  const [loading, setLoading]                 = useState(false);
  const [loadingMore, setLoadingMore]         = useState(false);
  const [sidebarOpen, setSidebarOpen]         = useState(false);
  const [favorites, setFavorites]             = useState<Record<string, TemplatePrompt>>({});
  const [failedImageIds, setFailedImageIds]   = useState<Set<string>>(new Set());

  // Mine tab state
  const [userTemplates, setUserTemplates]     = useState<UserTemplate[]>([]);
  const [showCreateForm, setShowCreateForm]   = useState(false);
  const [deletingId, setDeletingId]           = useState<string | null>(null);
  const [formTitle, setFormTitle]             = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formContent, setFormContent]         = useState("");
  const [formImage, setFormImage]             = useState<string | null>(null);
  const [formErrors, setFormErrors]           = useState<{ title?: string; content?: string; image?: string }>({});
  const [dragOver, setDragOver]               = useState(false);
  const [saving, setSaving]                   = useState(false);
  const fileInputRef                          = useRef<HTMLInputElement>(null);

  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef      = useRef<HTMLDivElement>(null);
  const savedScrollPos = useRef(0);
  const loadMoreRef    = useRef<HTMLElement>(null);
  const refreshIconRef = useRef<HTMLSpanElement>(null);

  // Load favorites from localStorage on mount
  useEffect(() => {
    setFavorites(loadFavoritesFromStorage());
  }, []);

  // Load user templates when drawer opens
  useEffect(() => {
    if (!open) return;
    fetch("/api/user-templates")
      .then((r) => r.ok ? r.json() : [])
      .then((data: { id: string; title: string; description: string; content: string; thumbnailUrl: string | null; createdAt: number }[]) => {
        setUserTemplates(data.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          content: t.content,
          thumbnail: t.thumbnailUrl ?? "",
          createdAt: t.createdAt,
        })));
      })
      .catch(() => {});
  }, [open]);

  // (For You results persist across opens — use the refresh button to re-fetch)

  // Paste handler for the create form image zone
  useEffect(() => {
    if (!showCreateForm) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) processImageFile(file).then(setFormImage);
          break;
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [showCreateForm]);

  const toggleFavorite = useCallback((prompt: TemplatePrompt) => {
    setFavorites((prev) => {
      const next = { ...prev };
      if (next[prompt.id]) {
        delete next[prompt.id];
      } else {
        next[prompt.id] = prompt;
      }
      saveFavoritesToStorage(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  // Reset page + prompts and scroll to top when filters change
  useEffect(() => {
    setPage(0);
    setPrompts([]);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [category, subcategory, debouncedSearch]);

  // Reset subcategory when category changes
  useEffect(() => {
    setSubcategory("all");
  }, [category]);

  // Fetch prompts from API (skipped when viewing favorites, mine, or for-you)
  useEffect(() => {
    if (!open || category === "favorites" || category === "mine" || category === "for-you") return;
    const controller = new AbortController();

    async function fetchPrompts() {
      const isFirstPage = page === 0;
      isFirstPage ? setLoading(true) : setLoadingMore(true);
      try {
        const params = new URLSearchParams({ page: String(page), category, subcategory, search: debouncedSearch });
        const res = await fetch(`/api/templates?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error("Failed to fetch templates");
        const data: TemplatesResponse = await res.json();
        // Guard against stale responses that finished after the effect was cleaned up.
        if (controller.signal.aborted) return;
        setPrompts((prev) => {
          const merged = isFirstPage ? data.prompts : [...prev, ...data.prompts];
          return Array.from(new Map(merged.map((p) => [p.id, p])).values());
        });
        setTotal(data.total);
        setHasMore(data.hasMore);
        setCategoryCounts(data.categoryCounts);
        setSubcategoryCounts(data.subcategoryCounts);
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") console.error("[TemplateDrawer] fetch error:", err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    }

    fetchPrompts();
    return () => controller.abort();
  }, [open, page, category, subcategory, debouncedSearch]);

  // Save scroll position when closing; restore it when reopening.
  useEffect(() => {
    if (!open) {
      savedScrollPos.current = scrollRef.current?.scrollTop ?? 0;
      setSidebarOpen(false);
      setShowCreateForm(false);
      setDeletingId(null);
    } else {
      const id = setTimeout(() => {
        scrollRef.current?.scrollTo({ top: savedScrollPos.current });
      }, 50);
      return () => clearTimeout(id);
    }
  }, [open]);

  const handleSelect = useCallback((content: string, sourceRect: DOMRect) => {
    savedScrollPos.current = scrollRef.current?.scrollTop ?? 0;
    onSelectPrompt(content, sourceRect);
  }, [onSelectPrompt]);

  // ── Create form helpers ──────────────────────────────────────────────────────

  function resetForm() {
    setFormTitle("");
    setFormDescription("");
    setFormContent("");
    setFormImage(null);
    setFormErrors({});
    setDragOver(false);
  }

  function openCreateForm() {
    resetForm();
    setShowCreateForm(true);
  }

  function closeCreateForm() {
    setShowCreateForm(false);
    resetForm();
  }

  async function handleSaveTemplate() {
    const errors: { title?: string; content?: string; image?: string } = {};
    const title   = formTitle.trim();
    const content = formContent.trim();
    if (title.length < 3)    errors.title   = "Title must be at least 3 characters";
    if (content.length < 20) errors.content = "Prompt must be at least 20 characters";
    if (!formImage)          errors.image   = "An image is required";
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const body: Record<string, string> = { title, description: formDescription.trim(), content };
      const match = formImage!.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        body.thumbnailMimeType = match[1];
        body.thumbnailBase64 = match[2];
      }
      const res = await fetch("/api/user-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save template");
      const saved = await res.json() as { id: string; title: string; description: string; content: string; thumbnailUrl: string | null; createdAt: number };
      const template: UserTemplate = {
        id: saved.id,
        title: saved.title,
        description: saved.description,
        content: saved.content,
        thumbnail: saved.thumbnailUrl ?? formImage!,
        createdAt: saved.createdAt,
      };
      setUserTemplates((prev) => [template, ...prev]);
      setCategory("mine");
      closeCreateForm();
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTemplate(id: string) {
    await fetch(`/api/user-templates/${id}`, { method: "DELETE" });
    setUserTemplates((prev) => prev.filter((t) => t.id !== id));
    setDeletingId(null);
  }

  function handleImageFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    processImageFile(file).then((url) => {
      setFormImage(url);
      setFormErrors((prev) => ({ ...prev, image: undefined }));
    });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  }

  // ── Derived state ────────────────────────────────────────────────────────────

  // DEBUG: set to false once working, then remove all FOR_YOU_DEBUG blocks
  const FOR_YOU_DEBUG = true;

  const isMineView      = category === "mine";
  const isFavoritesView = category === "favorites";
  const isForYouView    = category === "for-you";

  // ── For You state ──────────────────────────────────────────────────────────
  const [forYouResults,  setForYouResults]  = useState<TemplatePrompt[]>([]);
  const [forYouLoading,  setForYouLoading]  = useState(false);
  const [forYouError,    setForYouError]    = useState<string | null>(null);
  const [forYouFetched,  setForYouFetched]  = useState(false);

  // ── For You rate limiting (3 real fetches per 10 min, cached results otherwise) ──
  const FOR_YOU_RATE_LIMIT  = 3;
  const FOR_YOU_WINDOW_MS   = 10 * 60 * 1000;

  function forYouGetTimes(): number[] {
    try { return JSON.parse(localStorage.getItem("fy-times") ?? "[]"); } catch { return []; }
  }
  function forYouIsLimited(): boolean {
    const now = Date.now();
    return forYouGetTimes().filter((t) => now - t < FOR_YOU_WINDOW_MS).length >= FOR_YOU_RATE_LIMIT;
  }
  function forYouRecordFetch() {
    const now = Date.now();
    const times = forYouGetTimes().filter((t) => now - t < FOR_YOU_WINDOW_MS);
    times.push(now);
    localStorage.setItem("fy-times", JSON.stringify(times));
  }
  function forYouGetCache(): TemplatePrompt[] {
    try { return JSON.parse(localStorage.getItem("fy-cache") ?? "[]"); } catch { return []; }
  }
  function forYouSetCache(results: TemplatePrompt[]) {
    try { localStorage.setItem("fy-cache", JSON.stringify(results)); } catch {}
  }

  // ── For You seen-template exclusion (7-day cooldown per template) ──
  const FOR_YOU_SEEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
  function forYouGetSeen(): { id: string; seenAt: number }[] {
    try { return JSON.parse(localStorage.getItem("fy-seen") ?? "[]"); } catch { return []; }
  }
  function forYouMarkSeen(ids: string[]) {
    const now = Date.now();
    const existing = forYouGetSeen().filter((e) => now - e.seenAt < FOR_YOU_SEEN_TTL && !ids.includes(e.id));
    const next = [...existing, ...ids.map((id) => ({ id, seenAt: now }))];
    try { localStorage.setItem("fy-seen", JSON.stringify(next.slice(-500))); } catch {}
  }
  function forYouFilterUnseen(results: TemplatePrompt[]): TemplatePrompt[] {
    const now = Date.now();
    const seenIds = new Set(forYouGetSeen().filter((e) => now - e.seenAt < FOR_YOU_SEEN_TTL).map((e) => e.id));
    const unseen = results.filter((p) => !seenIds.has(p.id));
    // If filtering leaves fewer than 6, relax and return all (avoids empty grid)
    return unseen.length >= 6 ? unseen : results;
  }

  useEffect(() => {
    if (!open || !isForYouView || forYouFetched) return;

    async function fetchForYou() {
      setForYouLoading(true);
      setForYouError(null);

      // Rate limited — serve cached results silently
      if (forYouIsLimited()) {
        const cached = forYouGetCache();
        if (FOR_YOU_DEBUG) console.log("[ForYou] Rate limited — serving cache:", cached.length); // DEBUG
        if (cached.length > 0) {
          await new Promise((r) => setTimeout(r, 600)); // brief fake load
          setForYouResults(cached);
          setForYouFetched(true);
          setForYouLoading(false);
          return;
        }
        // No cache yet — fall through to real fetch
      }

      try {
        const historyRes = await fetch("/api/images?workspaceId=all&limit=100");
        const historyData = historyRes.ok ? await historyRes.json() : { items: [] };
        const sorted = (historyData.items as { prompt: string; timestamp: number }[])
          .sort((a, b) => b.timestamp - a.timestamp)
          .map((item) => item.prompt)
          .filter(Boolean);

        const recent = sorted.slice(0, 5);
        const remaining = sorted.slice(5);
        const shuffled = remaining.sort(() => Math.random() - 0.5).slice(0, 15);
        const recentPrompts = [...new Set([...recent, ...shuffled])];

        if (FOR_YOU_DEBUG) console.log("[ForYou] Sending prompts:", recentPrompts); // DEBUG

        if (recentPrompts.length < 3) {
          setForYouError("not-enough");
          return;
        }

        const debugParam = FOR_YOU_DEBUG ? "?debug=1" : ""; // DEBUG
        const res = await fetch(`/api/for-you${debugParam}`, { // DEBUG
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ prompts: recentPrompts }),
        });
        const data = await res.json();

        if (FOR_YOU_DEBUG) console.log("[ForYou] Response:", data); // DEBUG

        if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
        const results = data.prompts ?? [];
        const filtered = forYouFilterUnseen(results);
        forYouSetCache(filtered);
        forYouRecordFetch();
        forYouMarkSeen(filtered.map((p: TemplatePrompt) => p.id));
        setForYouResults(filtered);
        setForYouFetched(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[ForYou] Error:", msg);
        // Fall back to cache on error
        const cached = forYouGetCache();
        if (cached.length > 0) {
          setForYouResults(cached);
          setForYouFetched(true);
        } else {
          setForYouError(msg);
        }
      } finally {
        setForYouLoading(false);
      }
    }

    fetchForYou();
  }, [open, isForYouView, forYouFetched, FOR_YOU_DEBUG]);

  const lowerSearch = useMemo(() => debouncedSearch.toLowerCase(), [debouncedSearch]);

  const favoritesList = useMemo(() => Object.values(favorites), [favorites]);

  const filteredFavorites = useMemo(() => {
    if (!lowerSearch) return favoritesList;
    return favoritesList
      .map((p) => {
        let score = 0;
        if (p.title.toLowerCase().includes(lowerSearch))       score += 3;
        if (p.description.toLowerCase().includes(lowerSearch)) score += 2;
        if (p.author.toLowerCase().includes(lowerSearch))      score += 1;
        if (p.content.toLowerCase().includes(lowerSearch))     score += 1;
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p);
  }, [favoritesList, lowerSearch]);

  const filteredMineTemplates = useMemo(() => {
    if (!lowerSearch) return userTemplates;
    return userTemplates.filter((t) =>
      t.title.toLowerCase().includes(lowerSearch) ||
      t.content.toLowerCase().includes(lowerSearch) ||
      t.description.toLowerCase().includes(lowerSearch)
    );
  }, [userTemplates, lowerSearch]);

  const displayedPrompts = useMemo(
    () => (isFavoritesView ? filteredFavorites : prompts).filter(
      (p) => p.thumbnail !== null && !failedImageIds.has(p.id)
    ),
    [isFavoritesView, filteredFavorites, prompts, failedImageIds]
  );

  const displayedTotal   = isFavoritesView ? filteredFavorites.length : total;
  const displayedHasMore = isFavoritesView ? false : hasMore;


  // Auto-load next page when the spinner scrolls into view,
  // but only after the user has manually clicked "Load more" at least once.
  // Delay attaching the observer so the DOM can reflow with newly loaded content
  // first — without this, mobile fires the observer immediately since the small
  // viewport keeps the sentinel in view even after new rows are appended.
  useEffect(() => {
    const btn = loadMoreRef.current;
    if (!btn || !displayedHasMore || loadingMore || page === 0) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setPage((p) => p + 1); },
      { threshold: 0.1 }
    );
    timer = setTimeout(() => observer.observe(btn), 400);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [displayedHasMore, loadingMore, page]);

  const allCount = useMemo(
    () => Object.values(categoryCounts).reduce((a, b) => a + b, 0),
    [categoryCounts]
  );

  const getCategoryCount = useCallback((val: CategoryKey) => {
    if (val === "for-you")   return forYouResults.length;
    if (val === "mine")      return userTemplates.length;
    if (val === "favorites") return favoritesList.length;
    if (val === "all")       return allCount;
    return categoryCounts[val] ?? 0;
  }, [forYouResults.length, userTemplates.length, favoritesList.length, allCount, categoryCounts]);

  const subcategoryLabels  = SUBCATEGORY_LABELS[category] ?? {};
  const subcategoryEntries = useMemo(
    () => Object.entries(subcategoryCounts).sort((a, b) => b[1] - a[1]),
    [subcategoryCounts]
  );
  const showSubcategories  = !isFavoritesView && !isMineView && !isForYouView && HAS_SUBCATEGORIES.has(category) && subcategoryEntries.length > 0;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200] bg-black/85"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="panel"
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "tween", duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="fixed inset-x-0 bottom-0 z-[201] flex flex-col rounded-t-2xl border-t border-[var(--chrome-border)]"
            style={{ height: "90%", background: "var(--surface)", boxShadow: "0 -20px 60px rgba(0,0,0,0.6)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header bar */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--chrome-border)] shrink-0">
              <div className="flex items-center gap-3">
                <button
                  className="sm:hidden flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-hover)] transition-colors text-text-secondary hover:text-text-primary"
                  onClick={() => setSidebarOpen((v) => !v)}
                  aria-label="Toggle categories"
                >
                  <ChevronRight size={16} className={`transition-transform duration-200 ${sidebarOpen ? "rotate-90" : ""}`} />
                </button>
                <h2 className="text-base font-semibold text-text-primary">
                  {showCreateForm ? "New Template" : "Prompt Templates"}
                </h2>
                {!showCreateForm && !isMineView && displayedTotal > 0 && (
                  <span className="text-xs text-text-secondary/60 font-medium">{displayedTotal.toLocaleString()} prompts</span>
                )}
                {!showCreateForm && isMineView && userTemplates.length > 0 && (
                  <span className="text-xs text-text-secondary/60 font-medium">{userTemplates.length} template{userTemplates.length !== 1 ? "s" : ""}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {showCreateForm && (
                  <button
                    onClick={closeCreateForm}
                    className="flex items-center gap-1.5 rounded-lg bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-hover)] px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                  >
                    <ArrowLeft size={14} />
                    Back
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-hover)] transition-colors text-text-secondary hover:text-text-primary"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex flex-1 min-h-0">
              {/* Sidebar */}
              <aside
                className={`shrink-0 border-r border-[var(--chrome-border)] overflow-y-auto ${sidebarOpen ? "block" : "hidden"} sm:block w-full sm:w-[220px] absolute sm:relative inset-0 z-10 sm:z-auto`}
                style={{ background: "var(--surface)" }}
              >
                <div className="p-3 space-y-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50 px-2 py-2">
                    Categories
                  </p>
                  {CATEGORIES.map((cat) => {
                    const count    = getCategoryCount(cat.value);
                    const isActive = category === cat.value;
                    const isMineEntry = cat.value === "mine";
                    const isFavsEntry = cat.value === "favorites";
                    return (
                      <button
                        key={cat.value}
                        onClick={() => { setCategory(cat.value); setSidebarOpen(false); setShowCreateForm(false); }}
                        className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors duration-100 text-left ${
                          isActive
                            ? isMineEntry
                              ? "bg-[#a3e635]/10 text-[#a3e635] font-medium"
                              : isFavsEntry
                              ? "bg-red-500/10 text-red-400 font-medium"
                              : "bg-[#a3e635]/10 text-[#a3e635] font-medium"
                            : "text-text-secondary hover:bg-[var(--chrome-surface)] hover:text-text-primary"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          {cat.icon && (
                            <span className={
                              isActive && isFavsEntry ? "text-red-400"
                              : isActive ? "text-[#a3e635]"
                              : "text-text-secondary/50"
                            }>
                              {cat.icon}
                            </span>
                          )}
                          {cat.label}
                        </span>
                        {count > 0 && (
                          <span className={`text-[11px] tabular-nums ${
                            isActive
                              ? isFavsEntry ? "text-red-400/70" : "text-[#a3e635]/70"
                              : "text-text-secondary/50"
                          }`}>
                            {count.toLocaleString()}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </aside>

              {/* Main area */}
              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

                {/* ── Create form ── */}
                {showCreateForm ? (
                  <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
                    <div className="max-w-xl mx-auto space-y-5">

                      {/* Image upload zone */}
                      <div>
                        <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                          Image <span className="text-[#a3e635]">*</span>
                        </label>
                        <div
                          className={`relative rounded-xl border-2 border-dashed overflow-hidden transition-all duration-150 cursor-pointer ${
                            dragOver
                              ? "border-[#a3e635]/60 bg-[#a3e635]/5"
                              : formErrors.image
                              ? "border-red-500/50 bg-red-500/5"
                              : "border-[var(--chrome-border)] bg-[var(--chrome-surface)] hover:border-[var(--chrome-border-strong)] hover:bg-[var(--chrome-surface)]"
                          }`}
                          style={{ aspectRatio: "16/9" }}
                          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                          onDragLeave={() => setDragOver(false)}
                          onDrop={handleDrop}
                          onClick={() => !formImage && fileInputRef.current?.click()}
                        >
                          {formImage ? (
                            <div className="relative w-full h-full group/img">
                              <img src={formImage} alt="Template preview" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/40 transition-colors flex items-center justify-center">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setFormImage(null); }}
                                  className="opacity-0 group-hover/img:opacity-100 flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-xs text-white transition-opacity"
                                >
                                  <X size={12} /> Remove
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-secondary/50 pointer-events-none">
                              <Upload size={22} className={dragOver ? "text-[#a3e635]" : ""} />
                              <p className="text-sm font-medium">Click to upload or drag and drop</p>
                              <p className="text-xs text-text-secondary/30">Or paste an image (Ctrl+V) — including generated images</p>
                            </div>
                          )}
                        </div>
                        {formErrors.image && <p className="mt-1.5 text-xs text-red-400">{formErrors.image}</p>}
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleImageFile(file);
                            e.target.value = "";
                          }}
                        />
                      </div>

                      {/* Title */}
                      <div>
                        <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                          Title <span className="text-[#a3e635]">*</span>
                        </label>
                        <input
                          type="text"
                          value={formTitle}
                          onChange={(e) => {
                            if (e.target.value.length <= 60) {
                              setFormTitle(e.target.value);
                              if (formErrors.title) setFormErrors((p) => ({ ...p, title: undefined }));
                            }
                          }}
                          placeholder="Give your template a name"
                          className={`w-full rounded-lg border bg-[var(--chrome-surface)] px-4 py-2.5 text-sm text-text-primary placeholder-text-secondary/40 outline-none transition-colors ${
                            formErrors.title ? "border-red-500/50 focus:border-red-500/70" : "border-[var(--chrome-border)] focus:border-[var(--chrome-border-strong)]"
                          }`}
                        />
                        <div className="flex justify-between mt-1">
                          {formErrors.title
                            ? <p className="text-xs text-red-400">{formErrors.title}</p>
                            : <span />
                          }
                          <span className="text-[11px] text-text-secondary/40 tabular-nums">{formTitle.length}/60</span>
                        </div>
                      </div>

                      {/* Description */}
                      <div>
                        <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                          Description <span className="text-text-secondary/40 font-normal normal-case tracking-normal">optional</span>
                        </label>
                        <input
                          type="text"
                          value={formDescription}
                          onChange={(e) => {
                            if (e.target.value.length <= 150) setFormDescription(e.target.value);
                          }}
                          placeholder="What does this template do?"
                          className="w-full rounded-lg border border-[var(--chrome-border)] bg-[var(--chrome-surface)] px-4 py-2.5 text-sm text-text-primary placeholder-text-secondary/40 outline-none focus:border-[var(--chrome-border-strong)] transition-colors"
                        />
                        <div className="flex justify-end mt-1">
                          <span className="text-[11px] text-text-secondary/40 tabular-nums">{formDescription.length}/150</span>
                        </div>
                      </div>

                      {/* Prompt content */}
                      <div>
                        <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
                          Prompt <span className="text-[#a3e635]">*</span>
                        </label>
                        <textarea
                          value={formContent}
                          onChange={(e) => {
                            setFormContent(e.target.value);
                            if (formErrors.content && e.target.value.trim().length >= 20)
                              setFormErrors((p) => ({ ...p, content: undefined }));
                          }}
                          placeholder="The full prompt text that will be loaded into the command bar..."
                          rows={6}
                          className={`w-full rounded-lg border bg-[var(--chrome-surface)] px-4 py-3 text-sm text-text-primary placeholder-text-secondary/40 outline-none resize-none transition-colors leading-relaxed ${
                            formErrors.content ? "border-red-500/50 focus:border-red-500/70" : "border-[var(--chrome-border)] focus:border-[var(--chrome-border-strong)]"
                          }`}
                        />
                        <div className="flex justify-between mt-1">
                          {formErrors.content
                            ? <p className="text-xs text-red-400">{formErrors.content}</p>
                            : <span className="text-xs text-text-secondary/40">Minimum 20 characters</span>
                          }
                          <span className="text-[11px] text-text-secondary/40 tabular-nums">{formContent.length}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-3 pt-2">
                        <button
                          onClick={closeCreateForm}
                          className="rounded-lg border border-[var(--chrome-border)] bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-hover)] px-5 py-2.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveTemplate}
                          disabled={saving}
                          className="flex-1 rounded-lg bg-[#a3e635] hover:bg-[#bef264] disabled:opacity-50 px-5 py-2.5 text-sm font-semibold text-black transition-colors"
                        >
                          {saving ? "Saving..." : "Save Template"}
                        </button>
                      </div>
                    </div>
                  </div>

                ) : (
                  <>
                    {/* Search + subcategory pills */}
                    <div className="px-4 pt-3 pb-2 border-b border-[var(--chrome-border)] shrink-0 space-y-2.5">
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary/50 pointer-events-none" />
                          <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={
                              isMineView ? "Search your templates..."
                              : isFavoritesView ? "Search favourites..."
                              : "Search templates..."
                            }
                            style={{ fontSize: "16px" }}
                            className="w-full rounded-lg border border-[var(--chrome-border)] bg-[var(--chrome-surface)] pl-9 pr-4 py-2 text-sm text-text-primary placeholder-text-secondary/40 outline-none focus:border-[var(--chrome-border-strong)] transition-colors"
                          />
                          {search && (
                            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary/50 hover:text-text-secondary transition-colors">
                              <X size={13} />
                            </button>
                          )}
                        </div>
                        {isForYouView && (
                          <button
                            onClick={() => {
                              const el = refreshIconRef.current;
                              if (el) {
                                el.style.animation = "none";
                                void el.offsetHeight; // force reflow
                                el.style.animation = "refresh-flick 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97) forwards";
                              }
                              setForYouFetched(false);
                              setForYouError(null);
                              setForYouResults([]);
                            }}
                            className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-hover)] transition-colors text-text-secondary/80 hover:text-text-primary"
                            title="Refresh suggestions"
                          >
                            <span ref={refreshIconRef} style={{ display: "flex" }}>
                              <RefreshCw size={15} />
                            </span>
                          </button>
                        )}
                        <button
                          onClick={openCreateForm}
                          className="shrink-0 flex items-center gap-1.5 rounded-lg bg-[#a3e635] hover:bg-[#bef264] px-3 py-2 text-sm font-semibold text-black transition-colors"
                        >
                          <Plus size={14} />
                          New
                        </button>
                      </div>

                      {showSubcategories && (
                        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
                          <button
                            onClick={() => setSubcategory("all")}
                            className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-100 ${
                              subcategory === "all"
                                ? "bg-[#a3e635]/15 text-[#a3e635] border border-[#a3e635]/30"
                                : "bg-[var(--chrome-surface)] text-text-secondary/80 border border-[var(--chrome-border)] hover:text-text-primary/80 hover:bg-[var(--chrome-surface-hover)]"
                            }`}
                          >
                            All
                          </button>
                          {subcategoryEntries.map(([key, count]) => {
                            const isActive = subcategory === key;
                            return (
                              <button
                                key={key}
                                onClick={() => setSubcategory(key)}
                                className={`shrink-0 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-100 ${
                                  isActive
                                    ? "bg-[#a3e635]/15 text-[#a3e635] border border-[#a3e635]/30"
                                    : "bg-[var(--chrome-surface)] text-text-secondary/80 border border-[var(--chrome-border)] hover:text-text-primary/80 hover:bg-[var(--chrome-surface-hover)]"
                                }`}
                              >
                                {subcategoryLabels[key] ?? key}
                                <span className={`tabular-nums ${isActive ? "text-[#a3e635]/60" : "text-text-secondary/40"}`}>{count}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Grid */}
                    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
                      {/* For You view */}
                      {isForYouView ? (
                        forYouLoading ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {Array.from({ length: 12 }).map((_, i) => <ShimmerCard key={i} />)}
                          </div>
                        ) : forYouError === "not-enough" ? (
                          <div className="flex flex-col items-center justify-center h-full text-center py-20">
                            <Sparkles size={32} className="text-text-secondary/20 mb-3" />
                            <p className="text-text-secondary text-sm">Not enough history yet</p>
                            <p className="text-text-secondary/40 text-xs mt-1">Generate a few images first — suggestions will appear here</p>
                          </div>
                        ) : forYouError ? (
                          <div className="flex flex-col items-center justify-center h-full text-center py-20">
                            <p className="text-text-secondary text-sm">Could not load suggestions</p>
                            <p className="text-text-secondary/40 text-xs mt-1 max-w-xs">{forYouError}</p>
                            <button
                              onClick={() => { setForYouFetched(false); setForYouError(null); }}
                              className="mt-3 text-xs text-text-secondary/50 hover:text-text-secondary transition-colors underline underline-offset-2"
                            >
                              Retry
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                              {forYouResults.filter((p) => !!p.thumbnail && !failedImageIds.has(p.id)).map((prompt) => (
                                <PromptCard
                                  key={prompt.id}
                                  prompt={prompt}
                                  isFavorited={!!favorites[prompt.id]}
                                  onSelect={(rect) => handleSelect(prompt.content, rect)}
                                  onToggleFavorite={() => toggleFavorite(prompt)}
                                  onImageError={() => setFailedImageIds((prev) => new Set(prev).add(prompt.id))}
                                />
                              ))}
                            </div>
                          </>
                        )
                      ) : isMineView ? (
                        filteredMineTemplates.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full text-center py-20">
                            <User size={32} className="text-text-secondary/20 mb-3" />
                            {userTemplates.length === 0 ? (
                              <>
                                <p className="text-text-secondary text-sm">No templates yet</p>
                                <p className="text-text-secondary/40 text-xs mt-1 mb-4">Create your first template to save it here</p>
                                <button
                                  onClick={openCreateForm}
                                  className="flex items-center gap-1.5 rounded-lg bg-[#a3e635] hover:bg-[#bef264] px-4 py-2 text-sm font-semibold text-black transition-colors"
                                >
                                  <Plus size={14} /> New Template
                                </button>
                              </>
                            ) : (
                              <>
                                <p className="text-text-secondary text-sm">No templates match your search</p>
                                <button onClick={() => setSearch("")} className="mt-2 text-xs text-text-secondary/50 hover:text-text-secondary underline underline-offset-2 transition-colors">
                                  Clear search
                                </button>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {filteredMineTemplates.map((template) => (
                              <MineCard
                                key={template.id}
                                template={template}
                                onSelect={(rect) => handleSelect(template.content, rect)}
                                onDelete={() => setDeletingId(template.id)}
                                confirmingDelete={deletingId === template.id}
                                onConfirmDelete={() => handleDeleteTemplate(template.id)}
                                onCancelDelete={() => setDeletingId(null)}
                              />
                            ))}
                          </div>
                        )
                      ) : loading ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {Array.from({ length: 12 }).map((_, i) => <ShimmerCard key={i} />)}
                        </div>
                      ) : displayedPrompts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center py-20">
                          {isFavoritesView ? (
                            <>
                              <Heart size={32} className="text-text-secondary/20 mb-3" />
                              <p className="text-text-secondary text-sm">No favourites yet</p>
                              <p className="text-text-secondary/40 text-xs mt-1">Click the heart on any prompt to save it here</p>
                            </>
                          ) : (
                            <>
                              <p className="text-text-secondary text-sm">No templates found</p>
                              {(search || category !== "all" || subcategory !== "all") && (
                                <button
                                  onClick={() => { setSearch(""); setCategory("all"); setSubcategory("all"); }}
                                  className="mt-3 text-xs text-text-secondary/50 hover:text-text-secondary underline underline-offset-2 transition-colors"
                                >
                                  Clear filters
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {displayedPrompts.map((prompt) => (
                              <PromptCard
                                key={prompt.id}
                                prompt={prompt}
                                isFavorited={!!favorites[prompt.id]}
                                onSelect={(rect) => handleSelect(prompt.content, rect)}
                                onToggleFavorite={() => toggleFavorite(prompt)}
                                onImageError={() => setFailedImageIds((prev) => new Set(prev).add(prompt.id))}
                              />
                            ))}
                          </div>
                          <div className="mt-6 flex flex-col items-center gap-3">
                            <p className="text-xs text-text-secondary/50">
                              Showing {displayedPrompts.length.toLocaleString()} of {displayedTotal.toLocaleString()} prompts
                            </p>
                            {displayedHasMore && (
                              page > 0 ? (
                                <div ref={loadMoreRef as React.Ref<HTMLDivElement>} className="flex items-center justify-center py-2">
                                  <svg className="animate-spin h-5 w-5 text-text-secondary/50" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                </div>
                              ) : (
                                <button
                                  ref={loadMoreRef as React.Ref<HTMLButtonElement>}
                                  onClick={() => setPage((p) => p + 1)}
                                  disabled={loadingMore}
                                  className="rounded-lg border border-[var(--chrome-border)] bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-hover)] px-5 py-2 text-sm text-text-primary/70 hover:text-text-primary transition-colors disabled:opacity-50"
                                >
                                  {loadingMore ? "Loading..." : "Load more"}
                                </button>
                              )
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
