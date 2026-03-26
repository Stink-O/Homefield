"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Plus, X, Globe } from "lucide-react";
import ZoomModal from "./ZoomModal";
import Tooltip from "./Tooltip";
import { useApp } from "@/contexts/AppContext";
import { MODEL_IMAGE_LIMITS, type AttachedImage } from "@/lib/types";
import { saveDraftImages, loadDraftImages } from "@/lib/storage";
import ModelToggle from "./ModelToggle";
import AspectRatioSelector from "./AspectRatioSelector";
import QualitySelector from "./QualitySelector";
import BatchSizeSelector from "./BatchSizeSelector";

interface AttachedImageWithThumb extends AttachedImage {
  thumbnail: string;
  _blobUrl?: string; // temporary blob URL while encoding is in progress
}

interface CommandBarProps {
  onGenerate: (prompt: string, images?: AttachedImage[]) => void;
  promptRef?: React.MutableRefObject<((p: string) => void) | null>;
  restoreRef?: React.MutableRefObject<((prompt: string, images: AttachedImageWithThumb[]) => void) | null>;
  addImageRef?: React.MutableRefObject<((dataUrl: string) => void) | null>;
  textareaRectRef?: React.MutableRefObject<(() => DOMRect | null) | null>;
  batchMode?: boolean;
}

export default function CommandBar({ onGenerate, promptRef, restoreRef, addImageRef, textareaRectRef, batchMode }: CommandBarProps) {
  const { state, dispatch } = useApp();
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<AttachedImageWithThumb[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageScrollRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);
  const maxImages = MODEL_IMAGE_LIMITS[state.selectedModel] ?? 14;
  const hasEncoding = images.some((img) => !!img._blobUrl);
  const canGenerate = prompt.trim().length > 0 && !hasEncoding;
  const atLimit = images.length >= maxImages;

  // Debounced draft save — never blocks UI, skips pending (blob URL) entries
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyImages = useMemo(() => images.filter((img) => !img._blobUrl), [images]);
  useEffect(() => {
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => saveDraftImages(readyImages), 500);
    return () => { if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current); };
  }, [readyImages]);

  const triggerResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Measure target height without visually changing anything
    const prev = el.style.height;
    el.style.transition = "none";
    el.style.height = "auto";
    const target = Math.min(el.scrollHeight, 160) + "px";
    // Restore current height immediately so transition can animate from it
    el.style.height = prev;
    // Force layout flush, then animate to target
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    el.offsetHeight;
    el.style.transition = "";
    el.style.height = target;
  }, []);

  // Resize whenever prompt changes — runs after React commits the new value to
  // the DOM, so scrollHeight always reflects the actual new content.
  useEffect(() => {
    triggerResize();
  }, [prompt, triggerResize]);

  // Load saved prompt and reference images on mount
  useEffect(() => {
    const savedPrompt = localStorage.getItem("lastPrompt");
    if (savedPrompt) setPrompt(savedPrompt);
    loadDraftImages().then((imgs) => {
      if (imgs.length > 0) setImages(imgs);
    });
  }, []);

  useEffect(() => {
    if (promptRef) {
      promptRef.current = (p: string) => {
        setPrompt(p);
        localStorage.setItem("lastPrompt", p);
      };
    }
    return () => {
      if (promptRef) promptRef.current = null;
    };
  }, [promptRef]);

  useEffect(() => {
    if (restoreRef) {
      restoreRef.current = (p: string, imgs: AttachedImageWithThumb[]) => {
        setPrompt(p);
        localStorage.setItem("lastPrompt", p);
        setImages(imgs);
      };
    }
    return () => {
      if (restoreRef) restoreRef.current = null;
    };
  }, [restoreRef]);

  const generateRefThumbnail = useCallback((source: ImageBitmapSource): Promise<string> => {
    return createImageBitmap(source).then((bitmap) => {
      const MAX = 160;
      const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      return canvas.toDataURL("image/jpeg", 0.8);
    });
  }, []);

  const addImage = useCallback(async (dataUrl: string) => {
    const [meta, base64Data] = dataUrl.split(",");
    const mimeMatch = meta.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : "image/png";

    // Fetch as blob so createImageBitmap can decode off the main thread
    const blob = await fetch(dataUrl).then((r) => r.blob());
    const thumbnail = await generateRefThumbnail(blob);

    setImages((prev) => {
      if (prev.length >= maxImages) return prev;
      const next = [...prev, { base64: base64Data, mimeType: mime, thumbnail }];
      return next;
    });
  }, [maxImages, generateRefThumbnail]);

  useEffect(() => {
    if (addImageRef) {
      addImageRef.current = (dataUrl: string) => {
        addImage(dataUrl);
      };
    }
    return () => {
      if (addImageRef) addImageRef.current = null;
    };
  }, [addImageRef, addImage]);

  useEffect(() => {
    if (textareaRectRef) {
      textareaRectRef.current = () => textareaRef.current?.getBoundingClientRect() ?? null;
    }
    return () => { if (textareaRectRef) textareaRectRef.current = null; };
  }, [textareaRectRef]);


  const handleSubmit = useCallback(() => {
    if (!canGenerate) return;
    // Filter out any images still being encoded (blob URL placeholders)
    const ready = images.filter((img) => img.base64);
    onGenerate(
      prompt.trim(),
      ready.length > 0 ? ready.map(({ base64, mimeType }) => ({ base64, mimeType })) : undefined
    );
  }, [canGenerate, prompt, images, onGenerate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = () => {
    triggerResize();
  };

  const processFiles = useCallback((files: File[], currentCount?: number) => {
    const count = currentCount ?? images.length;
    const slots = maxImages - count;
    if (slots <= 0) return;
    const accepted = files.filter((f) => f.type.startsWith("image/")).slice(0, slots);
    if (!accepted.length) return;

    const placeholders: AttachedImageWithThumb[] = accepted.map((file) => {
      const blobUrl = URL.createObjectURL(file);
      return { base64: "", mimeType: file.type || "image/jpeg", thumbnail: blobUrl, _blobUrl: blobUrl };
    });
    setImages((prev) => [...prev, ...placeholders]);

    (async () => {
      for (let i = 0; i < placeholders.length; i++) {
        const file = accepted[i];
        const blobUrl = placeholders[i]._blobUrl!;
        try {
          const [thumbnail, dataUrl] = await Promise.all([
            generateRefThumbnail(file),
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = (ev) => resolve(ev.target!.result as string);
              reader.onerror = () => reject(new Error("FileReader failed"));
              reader.readAsDataURL(file);
            }),
          ]);
          const base64 = dataUrl.split(",")[1];
          const mime = file.type || "image/jpeg";
          setImages((prev) => {
            const idx = prev.findIndex((img) => img._blobUrl === blobUrl);
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = { base64, mimeType: mime, thumbnail };
            return next;
          });
        } catch {
          setImages((prev) => prev.filter((img) => img._blobUrl !== blobUrl));
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      }
    })();
  }, [images.length, maxImages, generateRefThumbnail]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    processFiles(files);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    if (atLimit) return;
    const files = Array.from(e.dataTransfer.files);
    processFiles(files);
  }, [atLimit, processFiles]);

  // Window-level drag tracking so the overlay appears regardless of where the
  // cursor enters the page. Counter handles nested element enter/leave pairs.
  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      dragCounterRef.current++;
      setIsDragOver(true);
    };
    const onLeave = () => {
      dragCounterRef.current--;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragOver(false);
      }
    };
    const onDrop = () => {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        if (atLimit) return;
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;

        // Add placeholder immediately
        const blobUrl = URL.createObjectURL(file);
        setImages((prev) => {
          if (prev.length >= maxImages) return prev;
          return [...prev, { base64: "", mimeType: file.type || "image/jpeg", thumbnail: blobUrl, _blobUrl: blobUrl }];
        });

        // Encode in background
        Promise.all([
          generateRefThumbnail(file),
          new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(ev.target!.result as string);
            reader.readAsDataURL(file);
          }),
        ]).then(([thumbnail, dataUrl]) => {
          const base64 = dataUrl.split(",")[1];
          const mime = file.type || "image/jpeg";
          setImages((prev) => {
            const idx = prev.findIndex((img) => img._blobUrl === blobUrl);
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = { base64, mimeType: mime, thumbnail };
            return next;
          });
          URL.revokeObjectURL(blobUrl);
        }).catch(() => {
          setImages((prev) => prev.filter((img) => img._blobUrl !== blobUrl));
          URL.revokeObjectURL(blobUrl);
        });
        break;
      }
    }
  };

  const handleRemoveImage = (index: number) => {
    setImages((prev) => {
      return prev.filter((_, i) => i !== index);
    });
    setPreviewIndex((prev) => {
      if (prev === null) return null;
      if (prev === index) return null;
      if (prev > index) return prev - 1;
      return prev;
    });
  };

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          e.preventDefault();
          textareaRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, []);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: batchMode ? 0 : 1, y: batchMode ? 10 : 0 }}
        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
        className="fixed bottom-0 left-0 right-0 z-40 pb-8 sm:pb-5 px-4 pointer-events-none hidden sm:block"
      >
        <div className={`relative mx-auto max-w-[860px] ${batchMode ? "pointer-events-none" : "pointer-events-auto"}`}>
          <div
            className="relative glass-command rounded-2xl p-4"
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={handleDrop}
          >
            <AnimatePresence initial={false}>
              {isDragOver && (
                <motion.div
                  key="drop-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="absolute inset-0 z-20 rounded-2xl flex items-center justify-center gap-3 pointer-events-none"
                  style={{ background: "rgba(0,0,0,0.7)", border: "2px solid var(--accent)", boxShadow: "0 0 0 4px rgba(163,230,53,0.15)" }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
                    {atLimit ? "Reference image limit reached" : "Drop to add as reference"}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence initial={false}>
              {images.length > 0 && (
                <motion.div
                  key="ref-images"
                  initial={{ height: 0, opacity: 0, marginBottom: 0 }}
                  animate={{ height: "auto", opacity: 1, marginBottom: 12 }}
                  exit={{ height: 0, opacity: 0, marginBottom: 0 }}
                  transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                  style={{ overflow: "hidden" }}
                >
                  <div
                    ref={imageScrollRef}
                    className="ref-image-scroll flex items-center gap-2 overflow-x-scroll pt-2 pb-1"
                    style={{ scrollbarWidth: "thin", scrollbarColor: "var(--chrome-handle) transparent" }}
                    onWheel={(e) => {
                      if (e.deltaY === 0) return;
                      e.preventDefault();
                      imageScrollRef.current!.scrollLeft += e.deltaY;
                    }}
                  >
                    {images.map((img, i) => (
                      <div key={i} className="relative inline-block flex-shrink-0">
                        {img._blobUrl ? (
                          <div className="h-14 w-14 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center">
                            <svg className="animate-spin text-white/80" width="18" height="18" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
                              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </div>
                        ) : (
                          <img
                            src={img.thumbnail}
                            alt={`Reference ${i + 1}`}
                            className="h-14 w-14 rounded-lg object-cover border border-white/10 cursor-pointer"
                            onClick={() => setPreviewIndex(i)}
                            title="Click to preview"
                          />
                        )}
                        <button
                          onClick={() => handleRemoveImage(i)}
                          className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white/80 hover:bg-black transition-colors"
                          title="Remove image"
                        >
                          <X size={9} />
                        </button>
                      </div>
                    ))}
                    {!atLimit && (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-shrink-0 h-14 w-14 flex items-center justify-center rounded-lg border border-dashed border-white/15 text-text-secondary/30 hover:border-white/30 hover:text-text-secondary/60 transition-colors"
                        title="Add reference image"
                      >
                        <Plus size={16} />
                      </button>
                    )}
                    <span className="text-[10px] text-text-secondary/40 flex-shrink-0 pl-1 whitespace-nowrap">
                      {images.length}/{maxImages}
                      {atLimit && " — limit reached"}
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-start gap-2">
              {images.length === 0 && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-secondary/30 hover:bg-white/10 hover:text-text-primary transition-colors"
                  title="Attach image"
                >
                  <Plus size={16} />
                </button>
              )}
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); localStorage.setItem("lastPrompt", e.target.value); }}
                onInput={handleInput}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Describe the scene you imagine..."
                rows={2}
                className="flex-1 resize-none bg-transparent px-1 py-1 text-base text-text-primary placeholder-text-secondary/55 outline-none disabled:opacity-40 leading-relaxed max-h-[30vh] overflow-y-auto transition-[height] duration-150 ease-in-out"
              />
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <ModelToggle />
                <div className="h-5 w-px bg-white/10" />
                <AspectRatioSelector />
                <div className="h-5 w-px bg-white/10" />
                <QualitySelector />
                <div className="h-5 w-px bg-white/10 hidden sm:block" />
                <div className="hidden sm:block"><BatchSizeSelector /></div>
                {state.selectedModel === "gemini-3.1-flash-image-preview" && (
                  <>
                    <div className="h-5 w-px bg-white/10" />
                    <Tooltip content="Grounds generation in real-time web data. Useful for current events, recent imagery, or specific real-world references.">
                      <button
                        onClick={() => dispatch({ type: "TOGGLE_SEARCH_GROUNDING" })}
                        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                          state.searchGrounding
                            ? "bg-accent/15 text-accent"
                            : "text-text-secondary/60 hover:text-text-primary hover:bg-[var(--border)]"
                        }`}
                      >
                        <Globe size={13} />
                        Search
                      </button>
                    </Tooltip>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                onClick={handleSubmit}
                disabled={!canGenerate}
                className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-black transition-all hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Sparkles size={15} />
                Generate
              </button>
            </div>
          </div>
        </div>
      </motion.div>

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
