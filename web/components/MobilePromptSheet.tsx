"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, ChevronUp, Globe, ImageIcon, Trash2 } from "lucide-react";
import { SortableImageStrip, type SortableImage } from "./SortableImageStrip";
import { useWebHaptics } from "web-haptics/react";
import Tooltip from "./Tooltip";
import ZoomModal from "./ZoomModal";
import { useApp } from "@/contexts/AppContext";
import { MODEL_IMAGE_LIMITS, type AttachedImage } from "@/lib/types";
import { saveDraftImages, loadDraftImages } from "@/lib/storage";
import ModelToggle from "./ModelToggle";
import AspectRatioSelector from "./AspectRatioSelector";
import QualitySelector from "./QualitySelector";
import BatchSizeSelector from "./BatchSizeSelector";

interface AttachedImageWithThumb extends AttachedImage {
  id?: string;
  thumbnail: string;
  _blobUrl?: string; // temporary blob URL while encoding is in progress
}

interface MobilePromptSheetProps {
  onGenerate: (prompt: string, images?: AttachedImage[]) => void;
  promptRef?: React.MutableRefObject<((p: string) => void) | null>;
  restoreRef?: React.MutableRefObject<((prompt: string, images: AttachedImageWithThumb[]) => void) | null>;
  addImageRef?: React.MutableRefObject<((url: string, mimeType?: string) => void) | null>;
}

export default function MobilePromptSheet({
  onGenerate,
  promptRef,
  restoreRef,
  addImageRef,
}: MobilePromptSheetProps) {
  const { state, dispatch } = useApp();
  const { trigger } = useWebHaptics();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [images, setImages] = useState<AttachedImageWithThumb[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipFocusRef = useRef(false);
  const maxImages = MODEL_IMAGE_LIMITS[state.selectedModel] ?? 14;
  const canGenerate = prompt.trim().length > 0;
  const atLimit = images.length >= maxImages;

  const triggerResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, []);

  // Focus textarea when sheet opens (unless suppressed for programmatic opens)
  useEffect(() => {
    if (open) {
      const shouldFocus = !skipFocusRef.current;
      skipFocusRef.current = false;
      setTimeout(() => {
        if (shouldFocus) textareaRef.current?.focus();
        triggerResize();
      }, 50);
    }
  }, [open, triggerResize]);

  // Load saved prompt and reference images on mount
  useEffect(() => {
    const savedPrompt = localStorage.getItem("lastPrompt");
    if (savedPrompt) setPrompt(savedPrompt);
    loadDraftImages().then((imgs) => {
      if (imgs.length > 0) setImages(imgs.map(img => ({ ...img, id: crypto.randomUUID() })));
    });
  }, []);

  // promptRef — set prompt and open sheet (no keyboard focus)
  useEffect(() => {
    if (promptRef) {
      promptRef.current = (p: string) => {
        setPrompt(p);
        localStorage.setItem("lastPrompt", p);
        skipFocusRef.current = true;
        setOpen(true);
        setTimeout(triggerResize, 0);
      };
    }
    return () => {
      if (promptRef) promptRef.current = null;
    };
  }, [promptRef, triggerResize]);

  // restoreRef — set prompt + images and open sheet
  useEffect(() => {
    if (restoreRef) {
      restoreRef.current = (p: string, imgs: AttachedImageWithThumb[]) => {
        setPrompt(p);
        localStorage.setItem("lastPrompt", p);
        const withIds = imgs.map(img => ({ ...img, id: crypto.randomUUID() }));
        setImages(withIds);
        saveDraftImages(withIds);
        setOpen(true);
        setTimeout(triggerResize, 0);
      };
    }
    return () => {
      if (restoreRef) restoreRef.current = null;
    };
  }, [restoreRef, triggerResize]);

  const addImage = useCallback(
    async (url: string, mimeType?: string) => {
      const isBlobUrl = url.startsWith("blob:");
      const mime = mimeType ?? (isBlobUrl ? "image/png" : (url.match(/data:([^;]+)/)?.[1] ?? "image/png"));
      const id = crypto.randomUUID();
      const marker = `pending:${id}`;

      setImages((prev) => {
        if (prev.length >= maxImages) return prev;
        return [...prev, { id, base64: "", mimeType: mime, thumbnail: "", _blobUrl: marker }];
      });

      try {
        const blob = await fetch(url).then((r) => r.blob());
        const [thumbnail, base64] = await Promise.all([
          new Promise<string>((resolve) => {
            createImageBitmap(blob).then((bitmap) => {
              const MAX = 160;
              const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
              const canvas = document.createElement("canvas");
              canvas.width = Math.round(bitmap.width * scale);
              canvas.height = Math.round(bitmap.height * scale);
              canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
              bitmap.close();
              resolve(canvas.toDataURL("image/jpeg", 0.8));
            });
          }),
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve((e.target!.result as string).split(",")[1]);
            reader.onerror = () => reject(new Error("FileReader failed"));
            reader.readAsDataURL(blob);
          }),
        ]);
        setImages((prev) => {
          const idx = prev.findIndex((img) => img.id === id);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = { id, base64, mimeType: mime, thumbnail };
          saveDraftImages(next.filter((img) => !img._blobUrl));
          return next;
        });
      } catch {
        setImages((prev) => prev.filter((img) => img.id !== id));
      } finally {
        if (isBlobUrl) URL.revokeObjectURL(url);
      }
    },
    [maxImages]
  );

  // addImageRef — add image and open sheet
  useEffect(() => {
    if (addImageRef) {
      addImageRef.current = (url: string, mimeType?: string) => {
        addImage(url, mimeType);
        setOpen(true);
      };
    }
    return () => {
      if (addImageRef) addImageRef.current = null;
    };
  }, [addImageRef, addImage]);

  const handleSubmit = useCallback(() => {
    if (!canGenerate) return;
    trigger("success");
    onGenerate(
      prompt.trim(),
      images.length > 0
        ? images.map(({ base64, mimeType }) => ({ base64, mimeType }))
        : undefined
    );
    setOpen(false);
  }, [canGenerate, prompt, images, onGenerate]);

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        if (atLimit) return;
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = (event) => {
          addImage(event.target?.result as string);
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = (event) => {
        addImage(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  };

  const handleReorder = useCallback((activeId: string, overId: string) => {
    setImages((prev) => {
      const oldIndex = prev.findIndex((img) => img.id === activeId);
      const newIndex = prev.findIndex((img) => img.id === overId);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, moved);
      return next;
    });
    setPreviewIndex(null);
  }, []);

  const handleRemoveImage = (index: number) => {
    setImages((prev) => {
      const next = prev.filter((_, i) => i !== index);
      saveDraftImages(next);
      return next;
    });
  };

  const handleClearAll = () => {
    setPrompt("");
    localStorage.setItem("lastPrompt", "");
    setImages([]);
    saveDraftImages([]);
  };

  return (
    <>
      {/* Trigger bar — only visible on mobile (hidden on sm+) */}
      <div className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-8 sm:hidden">
        <button
          onClick={() => setOpen(true)}
          className="w-full glass-command rounded-2xl px-4 py-3.5 flex items-center gap-3 text-left"
        >
          <Sparkles size={16} className="text-accent shrink-0" />
          <span className="flex-1 text-sm text-text-secondary/70 truncate">
            {prompt.trim().length > 0 ? prompt.trim() : "Describe the scene you imagine..."}
          </span>
          <ChevronUp size={16} className="text-text-secondary/60 shrink-0" />
        </button>
      </div>

      {/* Bottom sheet */}
      <AnimatePresence>
        {open && (
          <>
            {/* Dark overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/60"
              onClick={() => setOpen(false)}
            />

            {/* Sheet panel */}
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed inset-x-0 bottom-0 z-50 flex flex-col glass-command rounded-t-3xl"
              style={{ maxHeight: "90vh" }}
            >
              {/* Drag handle */}
              <div className="pt-3 pb-1 flex justify-center">
                <div className="w-10 h-1 rounded-full" style={{ background: "var(--chrome-handle)" }} />
              </div>

              {/* Header row with close button */}
              <div className="flex items-center justify-end px-4 pt-1 pb-2">
                <button
                  onClick={() => setOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-text-secondary/60 hover:text-text-primary transition-colors bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-hover)]"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Scrollable content */}
              <div className="overflow-y-auto flex-1 px-4">
                {/* Reference image box */}
                {images.length === 0 ? (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full mb-3 rounded-2xl flex flex-col items-center justify-center gap-2.5 py-5 transition-colors border border-[var(--chrome-border)] bg-[var(--chrome-surface)] active:bg-[var(--chrome-surface-hover)]"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--chrome-surface-hover)]">
                      <ImageIcon size={20} className="text-text-secondary/50" />
                    </div>
                    <span className="text-sm text-text-secondary/50">
                      Choose images to upload{" "}
                      <span className="text-text-secondary/30">(up to {maxImages})</span>
                    </span>
                  </button>
                ) : (
                  <div className="mb-3 rounded-2xl p-3 border border-[var(--chrome-border)] bg-[var(--chrome-surface)]">
                    <SortableImageStrip
                      images={images as SortableImage[]}
                      maxImages={maxImages}
                      onReorder={handleReorder}
                      onRemove={handleRemoveImage}
                      onPreview={setPreviewIndex}
                      onAdd={() => fileInputRef.current?.click()}
                      variant="mobile"
                    />
                  </div>
                )}

                {/* Textarea with clear border */}
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={(e) => { setPrompt(e.target.value); localStorage.setItem("lastPrompt", e.target.value); }}
                  onInput={triggerResize}
                  onPaste={handlePaste}
                  placeholder="Describe the scene you imagine..."
                  rows={3}
                  className="w-full resize-none bg-transparent rounded-xl px-3 py-2.5 text-base text-text-primary placeholder-text-secondary/40 outline-none leading-relaxed transition-colors border border-[var(--chrome-border)] focus:border-[var(--chrome-border-strong)]"
                />
              </div>

              {/* Controls + Generate — outside overflow container so dropdowns aren't clipped */}
              <div className="px-4 pt-2 pb-6">
                {/* Model | Search (outside box) | trash far right */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="inline-flex items-center rounded-2xl border border-dashed border-[var(--chrome-border-strong)]" style={{ background: "linear-gradient(135deg, var(--chrome-surface-hover) 0%, var(--chrome-surface) 100%)" }}>
                    <ModelToggle />
                  </div>
                  {state.selectedModel === "gemini-3.1-flash-image-preview" && (
                    <Tooltip content="Grounds generation in real-time web data. Useful for current events, recent imagery, or specific real-world references.">
                      <button
                        onClick={() => dispatch({ type: "TOGGLE_SEARCH_GROUNDING" })}
                        className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          state.searchGrounding
                            ? "bg-accent/15 text-accent border border-accent/25"
                            : "text-text-secondary/60 border border-[var(--chrome-border)] hover:text-text-primary hover:border-[var(--chrome-border-strong)]"
                        }`}
                      >
                        <Globe size={13} />
                        Search
                      </button>
                    </Tooltip>
                  )}
                  <button
                    onClick={handleClearAll}
                    className="ml-auto flex h-8 w-8 items-center justify-center rounded-xl border border-dashed border-red-500/25 text-red-500/60 hover:text-red-400 hover:border-red-400/40 transition-colors"
                    title="Clear prompt and images"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Aspect + quality + batch — left aligned, above generate */}
                <div className="flex items-center gap-1.5 mb-3">
                  <AspectRatioSelector />
                  <div className="h-5 w-px bg-[var(--chrome-border)]" />
                  <QualitySelector />
                  <div className="h-5 w-px bg-[var(--chrome-border)]" />
                  <BatchSizeSelector dropdown />
                </div>

                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />

                {/* Generate button — full width */}
                <button
                  onClick={handleSubmit}
                  disabled={!canGenerate}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-black transition-all hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Sparkles size={15} />
                  Generate
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {previewIndex !== null && images[previewIndex] && (
        <ZoomModal
          src={
            images[previewIndex].base64
              ? `data:${images[previewIndex].mimeType};base64,${images[previewIndex].base64}`
              : images[previewIndex].thumbnail
          }
          alt={`Reference image ${previewIndex + 1}`}
          onClose={() => setPreviewIndex(null)}
          caption={`Reference image ${previewIndex + 1} of ${images.length}`}
          onPrev={images.length > 1 ? () => setPreviewIndex((i) => i !== null ? (i - 1 + images.length) % images.length : null) : undefined}
          onNext={images.length > 1 ? () => setPreviewIndex((i) => i !== null ? (i + 1) % images.length : null) : undefined}
        />
      )}
    </>
  );
}
