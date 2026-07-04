"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface BeamOverlayProps {
  from: { x: number; y: number };
  to: { x: number; y: number };
  toSize: { width: number; height: number };
  onComplete: () => void;
}

const DRAW_CORE   = 210; // ms - ball travel time
const DRAIN_GLOW  =  60; // ms - glow tail drain after ball lands
const DRAIN_TRAIL = 100; // ms - trail tail drain after ball lands
const FADE_DUR    = 100; // ms - flare fade
const TOTAL       = DRAW_CORE + DRAIN_TRAIL + 60; // ms - when we call onComplete

const FLARE_DUR   = 300; // ms - landing flare pulse
const FLARE_DELAY = DRAW_CORE - 30;
const DRAIN_DUR   = 300; // ms - radial drain of the landing box
const DRAIN_DELAY = DRAW_CORE - 10;
const FADE_DELAY  = DRAW_CORE - 20;

// The ball, landing flare, and radial drain are driven by a single rAF loop
// instead of CSS animations. Their CSS equivalents (offset-path, @property
// interpolation, animated SVG geometry) have patchy support outside recent
// Chromium, and any one of them failing breaks the effect. Same curves, same
// timings — just a driver every browser has. The stroke-dash tails stay in
// CSS since stroke-dashoffset animation is universally supported.
const KEYFRAMES = `
  @keyframes hf-tail-glow {
    from { stroke-dashoffset: 0.28; }
    to   { stroke-dashoffset: -0.72; }
  }
  @keyframes hf-tail-trail {
    from { stroke-dashoffset: 0.48; }
    to   { stroke-dashoffset: -0.52; }
  }
  @keyframes hf-drain-glow {
    from { stroke-dashoffset: -0.72; }
    to   { stroke-dashoffset: -1.0; }
  }
  @keyframes hf-drain-trail {
    from { stroke-dashoffset: -0.52; }
    to   { stroke-dashoffset: -1.0; }
  }
`;

// Solves y for x on a CSS cubic-bezier timing curve (Newton-Raphson).
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX  = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY  = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-5) break;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return sampleY(Math.min(1, Math.max(0, t)));
  };
}

const easeBall = cubicBezier(0.55, 0, 0.35, 1); // ball travel (matches the tail draw)
const easeOut  = cubicBezier(0, 0, 0.58, 1);    // CSS "ease-out"
const easeIn   = cubicBezier(0.42, 0, 1, 1);    // CSS "ease-in"

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default function BeamOverlay({ from, to, toSize, onComplete }: BeamOverlayProps) {
  const ballRef  = useRef<SVGCircleElement>(null);
  const flareRef = useRef<SVGCircleElement>(null);
  const drainRef = useRef<HTMLDivElement>(null);

  // Single arc — quadratic bezier, control point offset perpendicular from midpoint
  const dx   = to.x - from.x;
  const dy   = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;

  const perpX = -dy / dist;
  const perpY =  dx / dist;

  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const bow  = Math.max(80, Math.min(dist * 0.38, 160));

  const cpX = midX + perpX * bow;
  const cpY = midY + perpY * bow;

  const d = `M ${from.x} ${from.y} Q ${cpX} ${cpY} ${to.x} ${to.y}`;

  useEffect(() => {
    const t = setTimeout(onComplete, TOTAL);
    return () => clearTimeout(t);
  }, [onComplete]);

  useEffect(() => {
    const start = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      const t = now - start;

      // Ball travel along the quadratic bezier + fade after landing
      const ball = ballRef.current;
      if (ball) {
        const p = easeBall(clamp01(t / DRAW_CORE));
        const inv = 1 - p;
        const x = inv * inv * from.x + 2 * inv * p * cpX + p * p * to.x;
        const y = inv * inv * from.y + 2 * inv * p * cpY + p * p * to.y;
        ball.setAttribute("cx", String(x));
        ball.setAttribute("cy", String(y));
        const fade = clamp01((t - FADE_DELAY) / FADE_DUR);
        ball.style.opacity = String(1 - easeIn(fade));
      }

      // Landing flare: r 2 → 7 → 14, opacity 0 → 0.9 → 0 (ease-out per segment)
      const flare = flareRef.current;
      if (flare) {
        const fl = clamp01((t - FLARE_DELAY) / FLARE_DUR);
        let r = 2;
        let o = 0;
        if (fl > 0) {
          if (fl <= 0.3) {
            const s = easeOut(fl / 0.3);
            r = 2 + 5 * s;
            o = 0.9 * s;
          } else {
            const s = easeOut((fl - 0.3) / 0.7);
            r = 7 + 7 * s;
            o = 0.9 * (1 - s);
          }
        }
        flare.setAttribute("r", String(r));
        flare.setAttribute("fill-opacity", String(o));
      }

      // Landing box: fill instantly (first 6%), then punch a transparent hole
      // outward from center (ease-out per segment)
      const drain = drainRef.current;
      if (drain) {
        const dt = clamp01((t - DRAIN_DELAY) / DRAIN_DUR);
        if (dt <= 0) {
          drain.style.opacity = "0";
        } else if (dt <= 0.06) {
          drain.style.opacity = String(easeOut(dt / 0.06));
        } else {
          drain.style.opacity = "1";
          const r = 150 * easeOut((dt - 0.06) / 0.94);
          drain.style.background =
            `radial-gradient(ellipse 46% 72% at 50% 50%, transparent ${r}%, rgba(163,230,53,0.25) ${r + 25}%)`;
        }
      }

      if (t < DRAIN_DELAY + DRAIN_DUR) raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // Geometry props are stable for the lifetime of one overlay instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sharedPath = {
    fill:          "none",
    strokeLinecap: "round" as const,
    pathLength:    1,
  };

  const glowStyle: React.CSSProperties = {
    strokeDasharray:  "0.28 10",
    strokeDashoffset: "0.28",
    animation: [
      `hf-tail-glow  ${DRAW_CORE}ms  cubic-bezier(0.55,0,0.35,1) 0ms          forwards`,
      `hf-drain-glow ${DRAIN_GLOW}ms ease-in                      ${DRAW_CORE}ms forwards`,
    ].join(", "),
  };

  const trailStyle: React.CSSProperties = {
    strokeDasharray:  "0.48 10",
    strokeDashoffset: "0.48",
    animation: [
      `hf-tail-trail  ${DRAW_CORE}ms   cubic-bezier(0.55,0,0.35,1) 0ms          forwards`,
      `hf-drain-trail ${DRAIN_TRAIL}ms ease-in                      ${DRAW_CORE}ms forwards`,
    ].join(", "),
  };

  const glowLeft = to.x - toSize.width  / 2;
  const glowTop  = to.y - toSize.height / 2;

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <style>{KEYFRAMES}</style>

      {/* Fill box with color, then transparent hole punches outward from center */}
      <div
        ref={drainRef}
        style={{
          position:      "fixed",
          left:          glowLeft,
          top:           glowTop,
          width:         toSize.width,
          height:        toSize.height,
          borderRadius:  "8px",
          background:    "rgba(163,230,53,0.25)",
          pointerEvents: "none",
          zIndex:        9998,
          opacity:       0,
        }}
      />

      <svg
        style={{
          position:      "fixed",
          inset:         0,
          width:         "100vw",
          height:        "100vh",
          pointerEvents: "none",
          zIndex:        9999,
          overflow:      "visible",
        }}
      >
        <defs>
          <filter id="hf-blur-trail" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5 3" result="blur" />
            <feComposite in="blur" in2="SourceGraphic" operator="over" />
          </filter>
          <filter id="hf-blur-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.5 1.5" />
          </filter>
          <filter id="hf-flare-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        {/* Trail layer */}
        <path
          {...sharedPath}
          d={d}
          stroke="#a3e635"
          strokeWidth="9"
          strokeOpacity="0.15"
          filter="url(#hf-blur-trail)"
          style={trailStyle}
        />

        {/* Glow layer */}
        <path
          {...sharedPath}
          d={d}
          stroke="#a3e635"
          strokeWidth="4"
          strokeOpacity="0.4"
          filter="url(#hf-blur-glow)"
          style={glowStyle}
        />

        {/* Ball */}
        <circle
          ref={ballRef}
          cx={from.x}
          cy={from.y}
          r={5}
          fill="#a3e635"
          filter="url(#hf-flare-glow)"
        />

        {/* Landing flare */}
        <circle
          ref={flareRef}
          cx={to.x}
          cy={to.y}
          r={2}
          fill="#a3e635"
          fillOpacity={0}
          filter="url(#hf-flare-glow)"
        />
      </svg>
    </>,
    document.body
  );
}
