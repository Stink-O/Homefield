"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ImageIcon, X, ChevronDown, ChevronUp, Play, Trash2 } from "lucide-react";

type ModelId = "lyria-3-pro-preview" | "lyria-3-clip-preview";
type DurationPreset = 30 | 60 | 180 | 240;

interface AttachedImage { preview: string; base64: string; mimeType: string; }

const DURATION_PRESETS: { label: string; value: DurationPreset }[] = [
  { label: "Short", value: 30 },
  { label: "Med",   value: 60 },
  { label: "Long",  value: 180 },
  { label: "Full",  value: 240 },
];

const DURATION_LABELS: Record<DurationPreset, string> = {
  30: "30s", 60: "1min", 180: "3min", 240: "4min",
};

const CHIPS = ["Phonk", "Lo-fi Beats", "Rock Anthem", "Chillwave"];

/* ─── Oscilloscope waveform ─────────────────────────────────── */
function OscWave() {
  const n = 32;
  const heights = Array.from({ length: n }, (_, i) => {
    const x = (i / n) * Math.PI * 4;
    return 0.18 + 0.52 * Math.abs(Math.sin(x)) + 0.3 * Math.abs(Math.sin(x * 2.4 + 1.1));
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, height: 60 }}>
      {heights.map((h, i) => (
        <div key={i} style={{
          width: 3, height: h * 60,
          background: "linear-gradient(to top, #a3e635, rgba(163,230,53,0.45))",
          borderRadius: 2, transformOrigin: "center",
          boxShadow: "0 0 7px rgba(163,230,53,0.45)",
          animation: `oscPulse ${0.32 + (i % 9) * 0.048}s ease-in-out ${i * 0.018}s infinite alternate`,
        }} />
      ))}
    </div>
  );
}

/* ─── Toggle pill with tooltip ──────────────────────────────── */
function TooltipPill({ label, hint, value, onToggle }: {
  label: string; hint: string; value: boolean; onToggle: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ position: "relative" }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    >
      <button onClick={onToggle} style={{
        background: value ? "rgba(163,230,53,0.12)" : "rgba(255,255,255,0.04)",
        border: value ? "1px solid rgba(163,230,53,0.25)" : "1px solid rgba(255,255,255,0.08)",
        borderRadius: 6, padding: "4px 10px", cursor: "pointer",
        color: value ? "#a3e635" : "#71717a",
        fontSize: 11, fontFamily: "var(--font-jetbrains-mono, monospace)", letterSpacing: "0.1em",
        transition: "all 0.15s",
      }}>
        {label}
      </button>
      {hovered && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 7px)", left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(8,8,8,0.97)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6, padding: "5px 10px",
          fontSize: 11, color: "#a1a1aa", fontFamily: "var(--font-jetbrains-mono, monospace)",
          whiteSpace: "nowrap", pointerEvents: "none", zIndex: 200,
          boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
        }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export interface MusicComposePanelProps {
  prompt: string;
  setPrompt: (v: string) => void;
  selectedModel: ModelId;
  setSelectedModel: (v: ModelId) => void;
  selectedDuration: DurationPreset;
  setSelectedDuration: (v: DurationPreset) => void;
  negativePrompt: string; setNegativePrompt: (v: string) => void;
  bpm: number | ""; setBpm: (v: number | "") => void;
  intensity: number; setIntensity: (v: number) => void;
  instrumentalMode: boolean; setInstrumentalMode: (v: boolean) => void;
  userLyrics: string; setUserLyrics: (v: string) => void;
  watermark: boolean; setWatermark: (v: boolean) => void;
  inputFiltering: boolean; setInputFiltering: (v: boolean) => void;
  outputFilteringRecitation: boolean; setOutputFilteringRecitation: (v: boolean) => void;
  outputFilteringVocalLikeness: boolean; setOutputFilteringVocalLikeness: (v: boolean) => void;
  promptRewriter: boolean; setPromptRewriter: (v: boolean) => void;
  advancedOpen: boolean; setAdvancedOpen: (v: boolean) => void;
  attachedImage: AttachedImage | null;
  onAttachImage: () => void;
  onRemoveImage: () => void;
  onPreviewImage: () => void;
  generating: boolean;
  onGenerate: () => void;
  onClear: () => void;
  error: string | null;
  onClearError: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isMobile?: boolean;
}

export default function MusicComposePanel({
  prompt, setPrompt, selectedModel, setSelectedModel,
  selectedDuration, setSelectedDuration,
  negativePrompt, setNegativePrompt, bpm, setBpm, intensity, setIntensity,
  instrumentalMode, setInstrumentalMode, userLyrics, setUserLyrics,
  watermark, setWatermark, inputFiltering, setInputFiltering,
  outputFilteringRecitation, setOutputFilteringRecitation,
  outputFilteringVocalLikeness, setOutputFilteringVocalLikeness,
  promptRewriter, setPromptRewriter, advancedOpen, setAdvancedOpen,
  attachedImage, onAttachImage, onRemoveImage, onPreviewImage,
  generating, onGenerate, onClear, error, onClearError,
  fileInputRef, onFileChange, isMobile = false,
}: MusicComposePanelProps) {
  const canGenerate = prompt.trim().length > 0 && !generating;
  const hasClearable = (prompt.trim().length > 0 || !!attachedImage) && !generating;

  const appendChip = (chip: string) => {
    const next = prompt ? `${prompt}, ${chip}` : chip;
    setPrompt(next);
    localStorage.setItem("music:prompt", next);
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      background: "var(--surface-elevated)",
      overflow: isMobile ? "auto" : "hidden",
      height: "100%",
    }}>
      {/* Panel header */}
      <div style={{
        padding: "14px 22px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, letterSpacing: "0.2em", color: "#71717a", fontFamily: "var(--font-jetbrains-mono, monospace)", textTransform: "uppercase" }}>
          Compose
        </span>

        {/* Tier toggle (Standard = clip, PRO = pro) */}
        <div style={{ display: "flex", gap: 2, padding: 2, background: "rgba(0,0,0,0.3)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)" }}>
          {([
            { id: "lyria-3-clip-preview" as ModelId, label: "Lyria 3 Clip" },
            { id: "lyria-3-pro-preview"  as ModelId, label: "Lyria 3 Pro" },
          ] as const).map(m => (
            <button key={m.id} onClick={() => setSelectedModel(m.id)}
              style={{ position: "relative", border: "none", background: "none", cursor: "pointer", padding: "5px 13px", borderRadius: 6, display: "flex", alignItems: "center", gap: 5 }}
            >
              {selectedModel === m.id && (
                <motion.div layoutId="model-pill"
                  style={{ position: "absolute", inset: 0, background: "rgba(163,230,53,0.09)", borderRadius: 6, border: "1px solid rgba(163,230,53,0.18)" }}
                  transition={{ type: "spring", bounce: 0.12, duration: 0.38 }}
                />
              )}
              <span style={{ position: "relative", display: "flex", alignItems: "center", gap: 5 }}>
                {selectedModel === m.id && (
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#a3e635", display: "inline-block", boxShadow: "0 0 7px rgba(163,230,53,0.9)", flexShrink: 0 }} />
                )}
                <span style={{ fontSize: 12, fontFamily: "var(--font-jetbrains-mono, monospace)", letterSpacing: "0.1em", color: selectedModel === m.id ? "#a3e635" : "#71717a", transition: "color 0.15s" }}>{m.label}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {isMobile ? (
        /* ── Mobile: stacked layout ── */
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          {/* Duration row */}
          <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, scrollbarWidth: "none" }}>
            {DURATION_PRESETS.map(p => {
              const isClip = selectedModel === "lyria-3-clip-preview";
              const disabled = isClip && p.value !== 30;
              const active = selectedDuration === p.value && !disabled;
              return (
                <button key={p.value} onClick={() => { if (!disabled) setSelectedDuration(p.value); }} disabled={disabled}
                  style={{
                    background: active ? "rgba(163,230,53,0.12)" : "rgba(255,255,255,0.04)",
                    border: active ? "1px solid rgba(163,230,53,0.3)" : "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 7, padding: "6px 14px", cursor: disabled ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
                    transition: "all 0.15s", opacity: disabled ? 0.3 : 1,
                  }}
                >
                  <span style={{ fontSize: 12, fontFamily: "var(--font-jetbrains-mono, monospace)", color: active ? "#a3e635" : "#71717a", letterSpacing: "0.04em" }}>{p.label}</span>
                  <span style={{ fontSize: 10, fontFamily: "var(--font-jetbrains-mono, monospace)", color: active ? "rgba(163,230,53,0.5)" : "#52525b" }}>{DURATION_LABELS[p.value]}</span>
                </button>
              );
            })}
          </div>

          {/* Textarea */}
          <textarea
            value={prompt}
            onChange={e => { setPrompt(e.target.value); localStorage.setItem("music:prompt", e.target.value); }}
            placeholder="What kind of track do you want to create?"
            disabled={generating} rows={5}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onGenerate(); }}
            className="hf-textarea"
            style={{
              display: "block", width: "100%", background: "transparent", border: "none",
              padding: "16px", color: "#b8b8b8",
              fontFamily: "var(--font-outfit, sans-serif)", fontSize: 15, lineHeight: 1.65,
              resize: "none", outline: "none", boxSizing: "border-box",
              opacity: generating ? 0.35 : 1, transition: "opacity 0.2s",
            }}
          />

          {/* Inspiration chips */}
          <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "10px 16px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, scrollbarWidth: "none" }}>
            {CHIPS.map(chip => (
              <button key={chip} onClick={() => appendChip(chip)}
                style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 6, padding: "6px 12px", cursor: "pointer", flexShrink: 0,
                  fontSize: 11, fontFamily: "var(--font-jetbrains-mono, monospace)",
                  color: "#71717a", letterSpacing: "0.06em", transition: "all 0.14s", whiteSpace: "nowrap",
                }}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* ── Desktop: three-column grid ── */
        <div style={{
          display: "grid", gridTemplateColumns: "136px 1fr 136px",
          gap: 0, flex: 1, overflow: "hidden", minHeight: 0,
        }}>
          {/* Left: Duration presets */}
          <div style={{
            borderRight: "1px solid rgba(255,255,255,0.06)",
            padding: "16px 14px", display: "flex", flexDirection: "column", gap: 10,
          }}>
            <span style={{ fontSize: 10, letterSpacing: "0.18em", color: "#52525b", fontFamily: "var(--font-jetbrains-mono, monospace)", textTransform: "uppercase" }}>
              Duration
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {DURATION_PRESETS.map(p => {
                const isClip = selectedModel === "lyria-3-clip-preview";
                const disabled = isClip && p.value !== 30;
                const active = selectedDuration === p.value && !disabled;
                return (
                  <button key={p.value}
                    onClick={() => { if (!disabled) setSelectedDuration(p.value); }}
                    disabled={disabled}
                    style={{
                      background: active ? "rgba(163,230,53,0.12)" : "rgba(255,255,255,0.04)",
                      border: active ? "1px solid rgba(163,230,53,0.3)" : "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 7, padding: "7px 4px",
                      cursor: disabled ? "not-allowed" : "pointer",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                      transition: "all 0.15s",
                      opacity: disabled ? 0.3 : 1,
                    }}
                  >
                    <span style={{ fontSize: 11, fontFamily: "var(--font-jetbrains-mono, monospace)", color: active ? "#a3e635" : "#71717a", letterSpacing: "0.04em", transition: "color 0.15s" }}>
                      {p.label}
                    </span>
                    <span style={{ fontSize: 10, fontFamily: "var(--font-jetbrains-mono, monospace)", color: active ? "rgba(163,230,53,0.5)" : "#52525b", transition: "color 0.15s" }}>
                      {DURATION_LABELS[p.value]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Center: Textarea */}
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <textarea
              value={prompt}
              onChange={e => { setPrompt(e.target.value); localStorage.setItem("music:prompt", e.target.value); }}
              placeholder="What kind of track do you want to create?"
              disabled={generating} rows={4}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onGenerate(); }}
              className="hf-textarea"
              style={{
                flex: 1, display: "block", width: "100%", background: "transparent", border: "none",
                padding: "18px 18px", color: "#b8b8b8",
                fontFamily: "var(--font-outfit, sans-serif)", fontSize: 15, lineHeight: 1.65,
                resize: "none", outline: "none", boxSizing: "border-box", height: "100%",
                opacity: generating ? 0.35 : 1, transition: "opacity 0.2s",
              }}
            />
          </div>

          {/* Right: Inspiration chips */}
          <div style={{
            borderLeft: "1px solid rgba(255,255,255,0.06)",
            padding: "16px 14px", display: "flex", flexDirection: "column", gap: 10,
          }}>
            <span style={{ fontSize: 10, letterSpacing: "0.18em", color: "#52525b", fontFamily: "var(--font-jetbrains-mono, monospace)", textTransform: "uppercase" }}>
              Inspiration
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {CHIPS.map(chip => (
                <button key={chip} onClick={() => appendChip(chip)}
                  style={{
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 6, padding: "6px 10px", cursor: "pointer", textAlign: "left",
                    fontSize: 11, fontFamily: "var(--font-jetbrains-mono, monospace)",
                    color: "#71717a", letterSpacing: "0.06em", transition: "all 0.14s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#a3e635"; e.currentTarget.style.borderColor = "rgba(163,230,53,0.25)"; e.currentTarget.style.background = "rgba(163,230,53,0.06)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "#71717a"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Advanced section */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <button
          onClick={() => setAdvancedOpen(!advancedOpen)}
          style={{ background: "none", border: "none", cursor: "pointer", padding: "9px 22px", display: "flex", alignItems: "center", gap: 5, color: advancedOpen ? "#a3e635" : "#71717a", fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", transition: "color 0.15s", width: "100%", textAlign: "left" }}
          onMouseEnter={e => (e.currentTarget.style.color = "#a3e635")}
          onMouseLeave={e => (e.currentTarget.style.color = advancedOpen ? "#a3e635" : "#71717a")}
        >
          {advancedOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          Advanced Options...
        </button>
        <div style={{ display: "grid", gridTemplateRows: advancedOpen ? "1fr" : "0fr", transition: "grid-template-rows 0.28s ease" }}>
          <div style={{ overflow: advancedOpen ? "visible" : "hidden" }}>
            <div style={{ padding: "0 22px 14px", display: "flex", flexDirection: "column", gap: 12 }}>

              {/* Mode */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11, letterSpacing: "0.16em", color: "#71717a", fontFamily: "var(--font-jetbrains-mono, monospace)", textTransform: "uppercase" }}>Mode</span>
                <div style={{ display: "flex", gap: 2, padding: 2, background: "rgba(0,0,0,0.3)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", alignSelf: "flex-start" }}>
                  {[{ label: "Vocal", value: false }, { label: "Instrumental", value: true }].map(opt => (
                    <button key={opt.label} onClick={() => setInstrumentalMode(opt.value)}
                      style={{ position: "relative", border: "none", background: "none", cursor: "pointer", padding: "5px 13px", borderRadius: 6, display: "flex", alignItems: "center", gap: 6 }}
                    >
                      {instrumentalMode === opt.value && (
                        <motion.div layoutId="mode-pill"
                          style={{ position: "absolute", inset: 0, background: "rgba(163,230,53,0.09)", borderRadius: 6, border: "1px solid rgba(163,230,53,0.18)" }}
                          transition={{ type: "spring", bounce: 0.12, duration: 0.38 }}
                        />
                      )}
                      <span style={{ position: "relative", fontSize: 12, fontFamily: "var(--font-jetbrains-mono, monospace)", letterSpacing: "0.1em", color: instrumentalMode === opt.value ? "#a3e635" : "#71717a", transition: "color 0.15s" }}>
                        {instrumentalMode === opt.value && (
                          <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: "#a3e635", boxShadow: "0 0 7px rgba(163,230,53,0.9)", marginRight: 5, verticalAlign: "middle" }} />
                        )}
                        {opt.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Lyrics (Vocal only) */}
              {!instrumentalMode && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 11, letterSpacing: "0.16em", color: "#71717a", fontFamily: "var(--font-jetbrains-mono, monospace)", textTransform: "uppercase" }}>Lyrics</span>
                  <textarea
                    value={userLyrics} onChange={e => setUserLyrics(e.target.value)}
                    placeholder="Optional lyrics to guide the vocal generation..."
                    rows={3} className="hf-textarea"
                    style={{ display: "block", width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "10px 12px", color: "#b8b8b8", fontFamily: "var(--font-outfit, sans-serif)", fontSize: 14, lineHeight: 1.6, resize: "vertical", outline: "none", boxSizing: "border-box" }}
                  />
                </div>
              )}

              {/* Negative prompt */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11, letterSpacing: "0.16em", color: "#71717a", fontFamily: "var(--font-jetbrains-mono, monospace)", textTransform: "uppercase" }}>Negative Prompt</span>
                <input type="text" value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)} placeholder="Elements to avoid..."
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", color: "#b8b8b8", fontFamily: "var(--font-outfit, sans-serif)", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" }}
                  onFocus={e => (e.currentTarget.style.borderColor = "rgba(163,230,53,0.25)")}
                  onBlur={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
                />
              </div>

              {/* BPM + Intensity */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 11, letterSpacing: "0.16em", color: "#71717a", fontFamily: "var(--font-jetbrains-mono, monospace)", textTransform: "uppercase" }}>BPM <span style={{ color: "#52525b", fontSize: 8 }}>(auto if empty)</span></span>
                  <input type="number" min={60} max={200} value={bpm} onChange={e => setBpm(e.target.value === "" ? "" : Number(e.target.value))} placeholder="Auto"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", color: "#b8b8b8", fontFamily: "var(--font-outfit, sans-serif)", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" }}
                    onFocus={e => (e.currentTarget.style.borderColor = "rgba(163,230,53,0.25)")}
                    onBlur={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, letterSpacing: "0.16em", color: "#71717a", fontFamily: "var(--font-jetbrains-mono, monospace)", textTransform: "uppercase" }}>Intensity</span>
                    <span style={{ fontSize: 12, color: "#a3e635", fontFamily: "var(--font-jetbrains-mono, monospace)" }}>{intensity.toFixed(2)}</span>
                  </div>
                  <input type="range" min={0} max={1} step={0.05} value={intensity} onChange={e => setIntensity(Number(e.target.value))} style={{ width: "100%", accentColor: "#a3e635", cursor: "pointer" }} />
                </div>
              </div>

              {/* Filters & Features */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11, letterSpacing: "0.16em", color: "#71717a", fontFamily: "var(--font-jetbrains-mono, monospace)", textTransform: "uppercase" }}>Filters &amp; Features</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <TooltipPill label="Watermark"         hint="Embed an inaudible watermark in the audio"         value={watermark}                    onToggle={() => setWatermark(!watermark)} />
                  <TooltipPill label="Input filter"      hint="Block inappropriate or harmful input prompts"      value={inputFiltering}               onToggle={() => setInputFiltering(!inputFiltering)} />
                  <TooltipPill label="Filter recitation" hint="Prevent output that recites copyrighted material"  value={outputFilteringRecitation}    onToggle={() => setOutputFilteringRecitation(!outputFilteringRecitation)} />
                  <TooltipPill label="Filter vocal"      hint="Prevent output that mimics real vocal likenesses"  value={outputFilteringVocalLikeness} onToggle={() => setOutputFilteringVocalLikeness(!outputFilteringVocalLikeness)} />
                  <TooltipPill label="Prompt rewriter"   hint="Auto-enhance your prompt for better results"      value={promptRewriter}               onToggle={() => setPromptRewriter(!promptRewriter)} />
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
            style={{ margin: "0 16px 0", background: "rgba(239,68,68,0.055)", border: "1px solid rgba(239,68,68,0.14)", borderRadius: 8, padding: "8px 12px", color: "rgba(239,68,68,0.75)", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}
          >
            {error}
            <button onClick={onClearError} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(239,68,68,0.35)", display: "flex", padding: 2 }}><X size={13} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generating state */}
      <AnimatePresence>
        {generating && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
            style={{ margin: "0 16px", background: "rgba(8,8,8,0.85)", border: "1px solid rgba(163,230,53,0.09)", borderRadius: 12, padding: "20px 28px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, flexShrink: 0, position: "relative", overflow: "hidden" }}
          >
            <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center bottom, rgba(163,230,53,0.035) 0%, transparent 65%)", pointerEvents: "none" }} />
            <OscWave />
            <span style={{ fontSize: 11, color: "#52525b", fontFamily: "var(--font-jetbrains-mono, monospace)", letterSpacing: "0.1em", position: "relative" }}>composing...</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action bar */}
      <div style={{ padding: "12px 16px 16px", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" style={{ display: "none" }} onChange={onFileChange} />

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AnimatePresence mode="wait">
            {attachedImage ? (
              <motion.div key="attached" initial={{ opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.88 }}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px 3px 3px", background: "rgba(163,230,53,0.055)", border: "1px solid rgba(163,230,53,0.14)", borderRadius: 6 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attachedImage.preview} alt="" onClick={onPreviewImage} style={{ width: 22, height: 22, objectFit: "cover", borderRadius: 4, cursor: "zoom-in" }} />
                <span onClick={onPreviewImage} style={{ fontSize: 12, color: "rgba(163,230,53,0.65)", fontFamily: "var(--font-jetbrains-mono, monospace)", letterSpacing: "0.08em", cursor: "zoom-in" }}>IMG</span>
                <button onClick={onRemoveImage} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "rgba(163,230,53,0.4)", display: "flex", lineHeight: 1 }}><X size={11} /></button>
              </motion.div>
            ) : (
              <motion.button key="add-img" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={onAttachImage}
                style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "6px 12px", color: "#71717a", fontSize: 12, fontFamily: "var(--font-jetbrains-mono, monospace)", letterSpacing: "0.08em", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, transition: "all 0.14s", whiteSpace: "nowrap" }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#a3e635"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(163,230,53,0.2)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#71717a"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.1)"; }}
              >
                <ImageIcon size={11} /> Use Image Reference
              </motion.button>
            )}
          </AnimatePresence>

          {hasClearable && (
            <button onClick={onClear}
              style={{ background: "none", border: "1px solid rgba(239,68,68,0.18)", borderRadius: 6, padding: "6px 12px", color: "rgba(239,68,68,0.45)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontFamily: "var(--font-jetbrains-mono, monospace)", letterSpacing: "0.06em", transition: "all 0.14s", whiteSpace: "nowrap" }}
              onMouseEnter={e => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.5)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "rgba(239,68,68,0.45)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.18)"; }}
            >
              <Trash2 size={11} /> Clear Prompt
            </button>
          )}
        </div>

        <button onClick={onGenerate} disabled={!canGenerate}
          style={{
            width: "100%", height: 44,
            background: canGenerate ? "#a3e635" : "rgba(163,230,53,0.1)",
            color: canGenerate ? "#000" : "rgba(163,230,53,0.28)",
            border: "none", borderRadius: 10,
            fontSize: 13, fontFamily: "var(--font-outfit, sans-serif)", fontWeight: 800,
            letterSpacing: "0.12em", cursor: canGenerate ? "pointer" : "not-allowed",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            transition: "all 0.15s",
            boxShadow: canGenerate ? "0 0 24px rgba(163,230,53,0.22)" : "none",
          }}
          onMouseEnter={e => { if (canGenerate) e.currentTarget.style.background = "#bef264"; }}
          onMouseLeave={e => { if (canGenerate) e.currentTarget.style.background = "#a3e635"; }}
        >
          {generating ? (
            <>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 11 }}>
                {[0.55, 1, 0.4, 0.75].map((h, i) => (
                  <div key={i} style={{ width: 2, height: h * 11, background: "rgba(0,0,0,0.4)", borderRadius: 1, transformOrigin: "bottom", animation: `oscPulse ${0.42 + i * 0.09}s ease-in-out ${i * 0.07}s infinite alternate` }} />
                ))}
              </div>
              GENERATING
            </>
          ) : (
            <><Play size={11} fill="currentColor" style={{ marginLeft: -1 }} /> GENERATE MUSIC</>
          )}
        </button>
      </div>
    </div>
  );
}
