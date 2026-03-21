"use client";

import { useEffect } from "react";
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

const KEYFRAMES = `
  @property --hf-drain-r {
    syntax: '<percentage>';
    inherits: false;
    initial-value: 0%;
  }
  @keyframes hf-beam-fade {
    from { opacity: 1; }
    to   { opacity: 0; }
  }
  @keyframes hf-ball-move {
    from { offset-distance: 0%; }
    to   { offset-distance: 100%; }
  }
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
  @keyframes hf-beam-flare {
    0%   { r: 2;  fill-opacity: 0; }
    30%  { r: 7;  fill-opacity: 0.9; }
    100% { r: 14; fill-opacity: 0; }
  }
  /* Fill box instantly, then punch a hole outward from center */
  @keyframes hf-radial-drain {
    0%   { --hf-drain-r: 0%;   opacity: 0; }
    6%   { --hf-drain-r: 0%;   opacity: 1; }
    100% { --hf-drain-r: 150%; opacity: 1; }
  }
`;

export default function BeamOverlay({ from, to, toSize, onComplete }: BeamOverlayProps) {
  useEffect(() => {
    const t = setTimeout(onComplete, TOTAL);
    return () => clearTimeout(t);
  }, [onComplete]);

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
        style={{
          position:      "fixed",
          left:          glowLeft,
          top:           glowTop,
          width:         toSize.width,
          height:        toSize.height,
          borderRadius:  "8px",
          background:    "radial-gradient(ellipse 46% 72% at 50% 50%, transparent var(--hf-drain-r), rgba(163,230,53,0.25) calc(var(--hf-drain-r) + 25%))",
          pointerEvents: "none",
          zIndex:        9998,
          opacity:       0,
          animation:     `hf-radial-drain 300ms ease-out ${DRAW_CORE - 10}ms forwards`,
        } as React.CSSProperties}
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
          r={5}
          fill="#a3e635"
          filter="url(#hf-flare-glow)"
          style={{
            offsetPath:     `path("${d}")`,
            offsetDistance: "0%",
            animation: [
              `hf-ball-move ${DRAW_CORE}ms cubic-bezier(0.55,0,0.35,1) forwards`,
              `hf-beam-fade ${FADE_DUR}ms ease-in ${DRAW_CORE - 20}ms forwards`,
            ].join(", "),
          } as React.CSSProperties}
        />

        {/* Landing flare */}
        <circle
          cx={to.x}
          cy={to.y}
          r={2}
          fill="#a3e635"
          fillOpacity={0}
          filter="url(#hf-flare-glow)"
          style={{ animation: `hf-beam-flare 300ms ease-out ${DRAW_CORE - 30}ms forwards` }}
        />
      </svg>
    </>,
    document.body
  );
}
