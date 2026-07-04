"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronRight, Heart, User, Plus, ArrowLeft } from "lucide-react";
import { type UserTemplate } from "@/lib/storage";
import {
  type TemplatePrompt,
  type TemplatesResponse,
  type CategoryKey,
  SUBCATEGORY_LABELS,
  HAS_SUBCATEGORIES,
  loadFavoritesFromStorage,
  saveFavoritesToStorage,
} from "./template-drawer/constants";
import { ShimmerCard, PromptCard, MineCard } from "./template-drawer/cards";
import { useForYou } from "./template-drawer/useForYou";
import CreateTemplateForm from "./template-drawer/CreateTemplateForm";
import CategorySidebar from "./template-drawer/CategorySidebar";
import DrawerToolbar from "./template-drawer/DrawerToolbar";
import ForYouGrid from "./template-drawer/ForYouGrid";

interface TemplateDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelectPrompt: (content: string, sourceRect: DOMRect) => void;
}

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

  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef      = useRef<HTMLDivElement>(null);
  const savedScrollPos = useRef(0);
  const loadMoreRef    = useRef<HTMLElement>(null);

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
      if (isFirstPage) setLoading(true); else setLoadingMore(true);
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

  // ── Create form ──────────────────────────────────────────────────────────────

  const openCreateForm  = () => setShowCreateForm(true);
  const closeCreateForm = () => setShowCreateForm(false);

  function handleTemplateSaved(template: UserTemplate) {
    setUserTemplates((prev) => [template, ...prev]);
    setCategory("mine");
    closeCreateForm();
  }

  async function handleDeleteTemplate(id: string) {
    await fetch(`/api/user-templates/${id}`, { method: "DELETE" });
    setUserTemplates((prev) => prev.filter((t) => t.id !== id));
    setDeletingId(null);
  }

  // ── Derived state ────────────────────────────────────────────────────────────

  const isMineView      = category === "mine";
  const isFavoritesView = category === "favorites";
  const isForYouView    = category === "for-you";

  // For You results persist across opens — use the refresh button to re-fetch
  const { forYouResults, forYouLoading, forYouError, refresh: refreshForYou, retry: retryForYou } = useForYou(open, isForYouView);

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
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setPage((p) => p + 1); },
      { threshold: 0.1 }
    );
    const timer = setTimeout(() => observer.observe(btn), 400);
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
              <CategorySidebar
                open={sidebarOpen}
                category={category}
                getCount={getCategoryCount}
                onSelect={(val) => { setCategory(val); setSidebarOpen(false); setShowCreateForm(false); }}
              />

              {/* Main area */}
              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

                {/* ── Create form ── */}
                {showCreateForm ? (
                  <CreateTemplateForm
                    scrollRef={scrollRef}
                    onCancel={closeCreateForm}
                    onSaved={handleTemplateSaved}
                  />
                ) : (
                  <>
                    <DrawerToolbar
                      search={search}
                      onSearchChange={setSearch}
                      searchPlaceholder={
                        isMineView ? "Search your templates..."
                        : isFavoritesView ? "Search favourites..."
                        : "Search templates..."
                      }
                      showForYouRefresh={isForYouView}
                      onRefreshForYou={refreshForYou}
                      onOpenCreate={openCreateForm}
                      showSubcategories={showSubcategories}
                      subcategory={subcategory}
                      onSubcategoryChange={setSubcategory}
                      subcategoryEntries={subcategoryEntries}
                      subcategoryLabels={subcategoryLabels}
                    />

                    {/* Grid */}
                    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
                      {/* For You view */}
                      {isForYouView ? (
                        <ForYouGrid
                          loading={forYouLoading}
                          error={forYouError}
                          results={forYouResults}
                          favorites={favorites}
                          failedImageIds={failedImageIds}
                          onSelect={handleSelect}
                          onToggleFavorite={toggleFavorite}
                          onImageError={(id) => setFailedImageIds((prev) => new Set(prev).add(id))}
                          onRetry={retryForYou}
                        />
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
