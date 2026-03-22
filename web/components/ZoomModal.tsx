"use client";

import { useState, useRef, useLayoutEffect, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, animate } from "framer-motion";
import { X } from "lucide-react";

interface ZoomModalProps {
  src: string;
  alt: string;
  onClose: () => void;
  caption?: React.ReactNode;
  onPrev?: () => void;
  onNext?: () => void;
  sidebar?: React.ReactNode;
  zIndex?: number;
}

// Easing for zoom: smooth ease-out quart — feels like maps/Figma
const ZOOM_EASE: [number, number, number, number] = [0.25, 1, 0.5, 1];
const ZOOM_DURATION = 0.12;

export default function ZoomModal({ src, alt, onClose, caption, onPrev, onNext, sidebar, zIndex = 400 }: ZoomModalProps) {
  // isZoomed is React state only for UI (cursor style, draggable, caption bar visibility).
  // Zoom % text is written directly to zoomPctRef — no re-render per frame during zoom.
  const [isZoomed, setIsZoomed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const zoomPctRef = useRef<HTMLSpanElement>(null);
  const [sidebarHeight, setSidebarHeight] = useState(220);
  const [isMobileView, setIsMobileView] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  // Current visual state — kept in a ref so wheel handler always sees latest values
  const animState = useRef({ zoom: 1, panX: 0, panY: 0 });
  // Cancel function for any in-flight animation
  const cancelAnim = useRef<(() => void) | null>(null);

  // Apply a transform to the DOM directly and record it in animState
  const applyTransform = useCallback((zoom: number, panX: number, panY: number) => {
    const wasZoomed = animState.current.zoom > 1;
    animState.current = { zoom, panX, panY };
    if (imgRef.current) {
      imgRef.current.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
    }
    if (zoomPctRef.current) {
      zoomPctRef.current.textContent = `${Math.round(zoom * 100)}%`;
    }
    const nowZoomed = zoom > 1;
    if (wasZoomed !== nowZoomed) setIsZoomed(nowZoomed);
  }, []);

  const reset = useCallback((animated = false) => {
    cancelAnim.current?.();
    cancelAnim.current = null;
    if (!animated) {
      applyTransform(1, 0, 0);
      return;
    }
    const { zoom: startZoom, panX: startPanX, panY: startPanY } = animState.current;
    if (startZoom === 1 && startPanX === 0 && startPanY === 0) return;
    const controls = animate(0, 1, {
      duration: 0.32,
      ease: ZOOM_EASE,
      onUpdate: (t) => {
        applyTransform(startZoom + (1 - startZoom) * t, startPanX * (1 - t), startPanY * (1 - t));
      },
      onComplete: () => {
        applyTransform(1, 0, 0);
      },
    });
    cancelAnim.current = () => controls.stop();
  }, [applyTransform]);

  // Reset when navigating to a different image
  useEffect(() => {
    cancelAnim.current?.();
    cancelAnim.current = null;
    applyTransform(1, 0, 0);
  }, [src, applyTransform]);

  // Lock page scroll — pad by scrollbar width to prevent layout shift on open/close
  useLayoutEffect(() => {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.documentElement.style.overflow;
    const prevPaddingRight = document.documentElement.style.paddingRight;
    document.documentElement.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.documentElement.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      document.documentElement.style.overflow = prevOverflow;
      document.documentElement.style.paddingRight = prevPaddingRight;
    };
  }, []);

  // Wheel zoom — capture phase + non-passive so preventDefault is honoured
  useLayoutEffect(() => {
    const handler = (e: WheelEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopImmediatePropagation();

      const imgEl = imgRef.current;
      if (!imgEl) return;

      const { zoom: startZoom, panX: startPanX, panY: startPanY } = animState.current;
      const targetZoom = Math.min(8, Math.max(1, startZoom * (e.deltaY < 0 ? 1.22 : 0.82)));
      if (targetZoom === startZoom) return;

      // Compute natural (un-transformed) center of the image.
      // getBoundingClientRect returns the post-transform rect, so subtract current pan.
      const imgRect = imgEl.getBoundingClientRect();
      const naturalCX = imgRect.left + imgRect.width / 2 - startPanX;
      const naturalCY = imgRect.top + imgRect.height / 2 - startPanY;
      const cx = e.clientX - naturalCX;
      const cy = e.clientY - naturalCY;

      // Stop any in-flight animation before starting a new one
      cancelAnim.current?.();
      cancelAnim.current = null;

      if (targetZoom === 1) {
        // Zoom out to rest — animate pan back to 0 alongside zoom
        const controls = animate(0, 1, {
          duration: ZOOM_DURATION,
          ease: ZOOM_EASE,
          onUpdate: (t) => {
            applyTransform(startZoom + (1 - startZoom) * t, startPanX * (1 - t), startPanY * (1 - t));
          },
          onComplete: () => {
            applyTransform(1, 0, 0);
          },
        });
        cancelAnim.current = () => controls.stop();
      } else {
        // Zoom in/out — pan is computed from animated zoom each frame so cursor stays fixed
        controls: {
          const controls = animate(0, 1, {
            duration: ZOOM_DURATION,
            ease: ZOOM_EASE,
            onUpdate: (t) => {
              const z = startZoom + (targetZoom - startZoom) * t;
              // pan derived from zoom: keeps the point under the cursor stationary
              applyTransform(z, cx - (cx - startPanX) * (z / startZoom), cy - (cy - startPanY) * (z / startZoom));
            },
            onComplete: () => {
              applyTransform(targetZoom, cx - (cx - startPanX) * (targetZoom / startZoom), cy - (cy - startPanY) * (targetZoom / startZoom));
            },
          });
          cancelAnim.current = () => controls.stop();
        }
      }
    };

    window.addEventListener("wheel", handler, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", handler, { capture: true });
  }, [applyTransform]);

  // Drag pan — document-level so fast movement doesn't drop events
  useLayoutEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const panX = dragRef.current.panX + (e.clientX - dragRef.current.startX);
      const panY = dragRef.current.panY + (e.clientY - dragRef.current.startY);
      applyTransform(animState.current.zoom, panX, panY);
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setIsDragging(false);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [applyTransform]);

  // Keyboard: Escape closes, arrows navigate
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      } else if (e.key === "ArrowLeft" && onPrev) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onPrev();
      } else if (e.key === "ArrowRight" && onNext) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onNext();
      }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [onClose, onPrev, onNext]);

  // Track mobile breakpoint
  useLayoutEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    setIsMobileView(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobileView(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Measure sidebar height dynamically so image padding always clears the bottom sheet
  useLayoutEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setSidebarHeight(entries[0]?.contentRect.height ?? 220);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sidebar]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    cancelAnim.current?.();
    cancelAnim.current = null;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: animState.current.panX,
      panY: animState.current.panY,
    };
    setIsDragging(true);
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`fixed inset-0 bg-black/92 overflow-hidden ${sidebar ? "sm:flex sm:flex-row" : "flex items-center justify-center"}`}
      style={{ zIndex, cursor: !isZoomed ? undefined : isDragging ? "grabbing" : undefined }}
      onClick={(e) => { if (!isDragging) { e.stopPropagation(); onClose(); } }}
    >
      <div className={sidebar ? "absolute inset-0 sm:relative sm:inset-auto sm:flex-1 sm:h-auto flex items-center justify-center overflow-hidden pt-10 px-10 sm:p-6 sm:pb-6" : "relative flex items-center justify-center w-full h-full"} style={sidebar && isMobileView ? { paddingBottom: `${sidebarHeight + 16}px` } : undefined}>
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={!isZoomed}
          onMouseDown={isZoomed ? handleMouseDown : undefined}
          onDoubleClick={(e) => { e.stopPropagation(); reset(true); }}
          onClick={(e) => e.stopPropagation()}
          style={{
            transformOrigin: "center center",
            willChange: "transform",
            cursor: !isZoomed ? "default" : isDragging ? "grabbing" : "grab",
            maxHeight: "100%",
            maxWidth: "100%",
            borderRadius: "8px",
            objectFit: "contain",
            userSelect: "none",
          }}
        />
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="absolute top-2 right-2 sm:top-4 sm:right-4 z-10 flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
          title="Close"
        >
          <X size={14} />
        </button>

        {onPrev && (
          <button
            onClick={(e) => { e.stopPropagation(); onPrev(); }}
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
            title="Previous image"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}

        {onNext && (
          <button
            onClick={(e) => { e.stopPropagation(); onNext(); }}
            className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
            title="Next image"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}

        {(caption || isZoomed) && (
          <div className="absolute sm:bottom-6 left-1/2 -translate-x-1/2 glass rounded-xl px-4 py-2 flex items-center gap-3" style={{ bottom: isMobileView ? `${sidebarHeight + 24}px` : undefined }}>
            {caption && <span className="text-xs text-text-secondary/60">{caption}</span>}
            {isZoomed && (
              <>
                {caption && <div className="w-px h-3 bg-[var(--chrome-border)]" />}
                <span ref={zoomPctRef} className="text-xs text-text-secondary/40">{Math.round(animState.current.zoom * 100)}%</span>
                <button
                  onClick={(e) => { e.stopPropagation(); reset(true); }}
                  className="text-xs text-text-secondary/40 hover:text-text-secondary transition-colors"
                >
                  reset
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {sidebar && (
        <div ref={sidebarRef} className="absolute bottom-0 left-0 right-0 max-h-[85vh] sm:relative sm:bottom-auto sm:left-auto sm:right-auto sm:max-h-full sm:w-72 sm:flex-shrink-0 overflow-y-auto sm:border-l sm:border-[var(--chrome-border)]">
          {sidebar}
        </div>
      )}
    </motion.div>,
    document.body
  );
}
