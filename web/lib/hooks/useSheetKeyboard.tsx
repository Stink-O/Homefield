"use client";

import { useEffect, useRef, useState } from "react";

/**
 * iOS software-keyboard handling for the mobile prompt sheet (issue #7).
 *
 * Context for future changes — the behaviors this works around were found by
 * live-testing on iPhone (Safari and Brave), and none of them are visible in
 * desktop devtools:
 *
 * 1. Viewport models. With `interactive-widget=resizes-content` set in
 *    app/layout.tsx, modern iOS WebKit shrinks the layout viewport for the
 *    keyboard, so a bottom-fixed sheet lands above the keyboard natively and
 *    `offset` computes ~0. Older WebKit ignores the meta and instead overlays
 *    the keyboard (visual viewport shrinks in place) and/or scrolls the
 *    layout viewport to reveal the focused field — sometimes different
 *    strategies on successive focuses. `offset` below compensates for both.
 *
 * 2. Repaint bug. iOS can leave the sheet's scrollable image area blank
 *    (laid out but never painted) when the keyboard resize lands while the
 *    sheet is mid-animation, and a later viewport adjustment can re-blank it.
 *    Only a reflow (e.g. typing) brings it back. `settleTick` increments
 *    350ms after the last viewport event; keying the scroll container on it
 *    forces a remount → guaranteed repaint. Don't "optimize" the key away.
 *
 * 3. Scroll bleed. iOS ignores overflow:hidden on body, so the page behind
 *    the sheet is pinned with position:fixed while open. Safari additionally
 *    lets the user drag the whole layout viewport while the keyboard is open
 *    (a built-in "reveal what's behind the keyboard" allowance) even with the
 *    body pinned, and chains scroll gestures that inner containers can't
 *    consume into that pan — so a document-level touchmove guard only lets a
 *    gesture through when an element under the finger (inside a
 *    [data-sheet-scroll] region) can actually scroll along the drag axis.
 *
 * 4. Safari's floating URL pill. With the keyboard up, real Safari draws its
 *    URL pill over the bottom ~50px of the viewport and reports it through no
 *    API (not visualViewport, not safe-area-inset-bottom). `safariPill` tells
 *    the sheet to reserve clearance under the Generate button. Brave mimics
 *    Safari's UA but exposes navigator.brave; other iOS browsers tag their UA
 *    (CriOS/FxiOS/...). Their bars sit outside the viewport, so no clearance.
 */

export interface SheetKeyboardState {
  /** Software keyboard is open (either viewport model). */
  open: boolean;
  /** Extra px to lift the sheet above the keyboard (0 when the browser resizes the viewport itself). */
  offset: number;
  /** Visual viewport height, used to cap the sheet so nothing lands behind the keyboard. */
  viewportH: number;
}

export function useSheetKeyboard(open: boolean) {
  const [kb, setKb] = useState<SheetKeyboardState>({ open: false, offset: 0, viewportH: 0 });
  const [settleTick, setSettleTick] = useState(0);
  // Ref mirror of kb.open for callbacks that shouldn't re-create on state
  // changes (e.g. the textarea auto-resize cap).
  const kbOpenRef = useRef(false);

  // Real-Safari detection for the URL-pill clearance (see header, point 4).
  // Lazy initializer, not an effect: the value never changes, and this hook's
  // consumer only mounts on user interaction, so there's no SSR/hydration
  // concern despite reading navigator.
  const [safariPill] = useState(() => {
    if (typeof navigator === "undefined") return false;
    const nav = navigator as Navigator & { brave?: unknown; standalone?: boolean };
    return (
      /Safari\//.test(nav.userAgent) &&
      !/CriOS|FxiOS|EdgiOS|OPR|OPT\/|Brave|DuckDuckGo/i.test(nav.userAgent) &&
      !nav.brave &&
      !nav.standalone
    );
  });

  // Track the keyboard via the visual viewport (see header, points 1–2).
  // State updates are deferred to a frame/event so the effect body itself
  // never sets state synchronously (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!open) {
      kbOpenRef.current = false;
      const raf = requestAnimationFrame(() => setKb({ open: false, offset: 0, viewportH: 0 }));
      return () => cancelAnimationFrame(raf);
    }
    const vv = window.visualViewport;
    if (!vv) return;
    let settleTimer = 0;
    const update = () => {
      // Two keyboard signals: visual viewport shrinks under a fixed window
      // (overlay model), or the window itself shrinks well below the device
      // screen height (resizes-content model).
      const kbOpen =
        window.innerHeight - vv.height * vv.scale > 80 ||
        window.screen.height - window.innerHeight > window.screen.height * 0.4;
      kbOpenRef.current = kbOpen;
      setKb({
        open: kbOpen,
        // Floor so a fractional viewport height can't leave a hairline gap
        // between the sheet and the keyboard.
        offset: Math.max(0, Math.floor(window.innerHeight - vv.height - vv.offsetTop)),
        viewportH: Math.floor(vv.height),
      });
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => setSettleTick((t) => t + 1), 350);
    };
    const raf = requestAnimationFrame(update);
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settleTimer);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [open]);

  // Pin the page behind the sheet (see header, point 3)
  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  // Swallow viewport-panning touch gestures (see header, point 3). Known
  // trade-off: drag-to-move-cursor inside a not-yet-scrollable textarea is
  // also swallowed while the sheet is open; taps and long-press still work.
  useEffect(() => {
    if (!open) return;
    let startX = 0;
    let startY = 0;
    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const horizontal = Math.abs(touch.clientX - startX) > Math.abs(touch.clientY - startY);
      const t = e.target;
      if (t instanceof Element) {
        const marker = t.closest("[data-sheet-scroll]");
        if (marker) {
          let el: Element | null = t;
          while (el) {
            const canScroll = horizontal
              ? el.scrollWidth > el.clientWidth + 1
              : el.scrollHeight > el.clientHeight + 1;
            if (canScroll) return;
            if (el === marker) break;
            el = el.parentElement;
          }
        }
      }
      e.preventDefault();
    };
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, [open]);

  return { kb, settleTick, kbOpenRef, safariPill };
}

/**
 * Diagnostic overlay for the keyboard handling above. Renders nothing unless
 * the page URL contains ?kbdebug — then it shows live viewport numbers and
 * the geometry/paint state of the sheet and its scroll area, screenshotable
 * on a phone where there are no devtools.
 */
export function SheetKeyboardDebug({
  sheetRef,
  scrollRef,
  kb,
}: {
  sheetRef: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  kb: SheetKeyboardState;
}) {
  // Lazy initializer: only mounted post-hydration (inside the open sheet),
  // so reading location here is safe and avoids setState-in-effect.
  const [enabled] = useState(
    () => typeof window !== "undefined" && window.location.search.includes("kbdebug")
  );
  const [txt, setTxt] = useState("");
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const vv = window.visualViewport;
      const s = sheetRef.current?.getBoundingClientRect();
      const sc = scrollRef.current?.getBoundingClientRect();
      const child = (scrollRef.current?.firstElementChild ?? null) as HTMLElement | null;
      const c = child?.getBoundingClientRect();
      const cs = child ? getComputedStyle(child) : null;
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom)";
      document.body.appendChild(probe);
      const sab = getComputedStyle(probe).paddingBottom;
      probe.remove();
      setTxt([
        `ih=${window.innerHeight} vvh=${vv?.height.toFixed(1)} ot=${vv?.offsetTop.toFixed(1)} sc=${vv?.scale} sab=${sab}`,
        `kb open=${kb.open} off=${kb.offset} vph=${kb.viewportH}`,
        `sheet ${s?.top.toFixed(0)}..${s?.bottom.toFixed(0)} h=${s?.height.toFixed(0)}`,
        `scroll ${sc?.top.toFixed(0)}..${sc?.bottom.toFixed(0)} h=${sc?.height.toFixed(0)} st=${scrollRef.current?.scrollTop}`,
        `child ${c?.top.toFixed(0)}..${c?.bottom.toFixed(0)} op=${cs?.opacity} vis=${cs?.visibility} disp=${cs?.display}`,
        `docScroll=${document.scrollingElement?.scrollTop}`,
      ].join("\n"));
    };
    tick();
    const t = window.setInterval(tick, 300);
    return () => window.clearInterval(t);
  }, [enabled, sheetRef, scrollRef, kb]);
  if (!enabled) return null;
  return (
    <pre className="absolute left-2 top-10 z-[999] pointer-events-none rounded bg-black/85 p-2 text-[10px] leading-tight text-lime-300 whitespace-pre">
      {txt}
    </pre>
  );
}
