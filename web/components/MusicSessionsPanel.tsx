"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useWavesurfer } from "@wavesurfer/react";
import {
  Play, Pause, Download, Trash2, FileText, Radio, Volume2,
  ChevronDown, ChevronUp, MoreVertical,
} from "lucide-react";

interface Track {
  id: string;
  prompt: string;
  model: string;
  filePath: string;
  mimeType: string;
  timestamp: number;
  lyrics?: string | null;
  description?: string | null;
}

function fmt(s: number) {
  if (!isFinite(s) || s < 0) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}
function ago(ts: number) {
  const d = Date.now() - ts;
  if (d < 60000) return "now";
  if (d < 3600000) return `${Math.floor(d / 60000)}m`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h`;
  return `${Math.floor(d / 86400000)}d`;
}

/* ─── Per-track decorative mini waveform ─────────────────────── */
function MiniWave({ active, seed }: { active: boolean; seed: number }) {
  const bars = 9;
  const hs = Array.from({ length: bars }, (_, i) => {
    const v = ((seed * 13 + i * 37) % 23) / 23;
    return 0.2 + v * 0.8;
  });
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 1.5, height: 20, opacity: active ? 1 : 0.3 }}>
      {hs.map((h, i) => (
        <div key={i} style={{
          width: 2, height: h * 20,
          background: active ? "#a3e635" : "#71717a",
          borderRadius: 1, transformOrigin: "bottom",
          ...(active && {
            animation: `oscPulse ${0.38 + i * 0.055}s ease-in-out ${i * 0.04}s infinite alternate`,
          }),
        }} />
      ))}
    </div>
  );
}

/* ─── Context menu ───────────────────────────────────────────── */
function ContextMenu({ track, displayName, onClose, onStartEdit, onDownload, onDelete, onCopyPrompt }: {
  track: Track;
  displayName: string;
  onClose: () => void;
  onStartEdit: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onCopyPrompt: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  void displayName; void track;

  return (
    <div ref={ref} style={{
      position: "absolute", right: 8, top: "calc(100% + 4px)", zIndex: 200,
      background: "rgba(14,14,14,0.98)", border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 10, padding: "4px 0", minWidth: 150,
      boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
    }}>
      {[
        { label: "Edit Title",   action: onStartEdit,  danger: false },
        { label: "Download",     action: onDownload,   danger: false },
      ].map(item => (
        <button key={item.label} onClick={() => { item.action(); onClose(); }}
          style={{ display: "block", width: "100%", padding: "7px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontSize: 13, color: "#a1a1aa", fontFamily: "var(--font-outfit, sans-serif)", transition: "color 0.12s, background 0.12s" }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#f5f5f5"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#a1a1aa"; }}
        >{item.label}</button>
      ))}
      <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "3px 0" }} />
      <button onClick={() => { onCopyPrompt(); onClose(); }}
        style={{ display: "block", width: "100%", padding: "7px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontSize: 13, color: "#a1a1aa", fontFamily: "var(--font-outfit, sans-serif)", transition: "color 0.12s, background 0.12s" }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#f5f5f5"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#a1a1aa"; }}
      >Copy Prompt</button>
      <button onClick={() => { onDelete(); onClose(); }}
        style={{ display: "block", width: "100%", padding: "7px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontSize: 13, color: "rgba(239,68,68,0.65)", fontFamily: "var(--font-outfit, sans-serif)", transition: "color 0.12s, background 0.12s" }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.05)"; e.currentTarget.style.color = "#ef4444"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "rgba(239,68,68,0.65)"; }}
      >Delete</button>
    </div>
  );
}

/* ─── Track row ──────────────────────────────────────────────── */
function TrackRow({ track, index, isActive, isDeleting, displayName, isEditingTitle, editingValue, contextMenuOpen, isMobile, onLoad, onDelete, onOpenContextMenu, onCloseContextMenu, onStartEditTitle, onCommitEditTitle, onCancelEditTitle, onEditTitleChange, onDownload, onCopyPrompt }: {
  track: Track; index: number; isActive: boolean; isDeleting: boolean;
  displayName: string; isEditingTitle: boolean; editingValue: string; contextMenuOpen: boolean;
  isMobile: boolean;
  onLoad: () => void; onDelete: () => void;
  onOpenContextMenu: () => void; onCloseContextMenu: () => void;
  onStartEditTitle: () => void; onCommitEditTitle: () => void;
  onCancelEditTitle: () => void; onEditTitleChange: (v: string) => void;
  onDownload: () => void; onCopyPrompt: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const seed = parseInt(track.id.slice(0, 4), 16);

  return (
    <div
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 18px",
        background: isActive ? "rgba(163,230,53,0.035)" : hovered ? "rgba(255,255,255,0.03)" : "transparent",
        borderLeft: `2px solid ${isActive ? "#a3e635" : "transparent"}`,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        cursor: "pointer", transition: "all 0.14s", opacity: isDeleting ? 0.25 : 1,
        position: "relative",
      }}
      onClick={() => { if (!isEditingTitle) onLoad(); }}
    >
      <span style={{ fontSize: 11, color: isActive ? "rgba(163,230,53,0.7)" : "#52525b", fontFamily: "var(--font-jetbrains-mono, monospace)", minWidth: 20, userSelect: "none" }}>
        {String(index + 1).padStart(2, "0")}
      </span>

      {!isMobile && <MiniWave active={isActive} seed={seed} />}

      <div style={{ flex: 1, minWidth: 0 }} onClick={e => { if (isEditingTitle) e.stopPropagation(); }}>
        {isEditingTitle ? (
          <input
            autoFocus
            value={editingValue}
            onChange={e => onEditTitleChange(e.target.value)}
            onBlur={onCommitEditTitle}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); onCommitEditTitle(); }
              if (e.key === "Escape") { e.preventDefault(); onCancelEditTitle(); }
            }}
            onClick={e => e.stopPropagation()}
            style={{
              background: "rgba(163,230,53,0.06)", border: "1px solid rgba(163,230,53,0.25)",
              borderRadius: 5, padding: "2px 8px", color: "#d8d8d8", fontSize: 13,
              fontFamily: "var(--font-outfit, sans-serif)", outline: "none", width: "100%",
              boxSizing: "border-box",
            }}
          />
        ) : (
          <div style={{ fontSize: 13, color: isActive ? "#d8d8d8" : "#a1a1aa", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", transition: "color 0.14s" }}>
            {displayName}
          </div>
        )}
      </div>

      {!isMobile && (
        <span style={{
          fontSize: 10, letterSpacing: "0.12em", fontFamily: "var(--font-jetbrains-mono, monospace)",
          padding: "1px 5px", borderRadius: 3, flexShrink: 0,
          background: isActive ? "rgba(163,230,53,0.08)" : "rgba(255,255,255,0.03)",
          color: isActive ? "rgba(163,230,53,0.7)" : "#71717a",
          border: `1px solid ${isActive ? "rgba(163,230,53,0.18)" : "rgba(255,255,255,0.05)"}`,
          transition: "all 0.14s",
        }}>
          {track.model === "lyria-3-clip-preview" ? "CLIP" : "PRO"}
        </span>
      )}

      {!isMobile && (
        <span style={{ fontSize: 11, color: "#52525b", fontFamily: "var(--font-jetbrains-mono, monospace)", flexShrink: 0, minWidth: 22, textAlign: "right" }}>
          {ago(track.timestamp)}
        </span>
      )}

      <div style={{ position: "relative", flexShrink: 0 }}>
        <button
          onClick={e => { e.stopPropagation(); contextMenuOpen ? onCloseContextMenu() : onOpenContextMenu(); }}
          style={{
            padding: 5, background: "none", border: "none", cursor: "pointer",
            color: hovered || contextMenuOpen ? "#a1a1aa" : "transparent",
            display: "flex", borderRadius: 5, transition: "color 0.14s",
          }}
        >
          <MoreVertical size={13} />
        </button>

        <AnimatePresence>
          {contextMenuOpen && (
            <motion.div key="ctx" initial={{ opacity: 0, scale: 0.94, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: -4 }} transition={{ duration: 0.12 }}>
              <ContextMenu
                track={track} displayName={displayName}
                onClose={onCloseContextMenu}
                onStartEdit={onStartEditTitle}
                onDownload={onDownload}
                onDelete={onDelete}
                onCopyPrompt={onCopyPrompt}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ─── Featured player ────────────────────────────────────────── */
function Player({ track, displayName, onDelete }: { track: Track; displayName: string; onDelete: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [volume, setVolume] = useState<number>(() => {
    if (typeof window === "undefined") return 0.8;
    return parseFloat(localStorage.getItem("music-volume") ?? "0.8");
  });
  const url = `/api/files/${track.filePath}`;

  const [waveReady, setWaveReady] = useState(false);
  const ringRef = useRef<SVGCircleElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

  const R = 28;
  const circumference = 2 * Math.PI * R;

  const { wavesurfer, isPlaying } = useWavesurfer({
    container: containerRef,
    url,
    height: 44,
    waveColor: "rgba(255,255,255,0.12)",
    progressColor: "#a3e635",
    cursorColor: "rgba(163,230,53,0.5)",
    cursorWidth: 1,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    normalize: true,
    interact: true,
  });

  useEffect(() => { setLyricsOpen(false); setWaveReady(false); }, [track.id]);
  useEffect(() => {
    if (!wavesurfer) return;
    const unsub = wavesurfer.on("ready", () => setWaveReady(true));
    return unsub;
  }, [wavesurfer]);

  useEffect(() => {
    if (!wavesurfer) return;
    let rafId: number;
    const tick = () => {
      const t = wavesurfer.getCurrentTime();
      const dur = wavesurfer.getDuration();
      if (ringRef.current) {
        const offset = dur > 0 ? circumference * (1 - t / dur) : circumference;
        ringRef.current.style.strokeDashoffset = String(offset);
      }
      if (timeRef.current) timeRef.current.textContent = fmt(t);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [wavesurfer, circumference]);

  useEffect(() => { wavesurfer?.setVolume(volume); }, [wavesurfer, volume]);

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    localStorage.setItem("music-volume", String(v));
  };

  const toggle = () => wavesurfer?.playPause();

  return (
    <div style={{
      padding: "18px 22px",
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: -40, right: -40, width: 180, height: 180, background: "radial-gradient(circle, rgba(163,230,53,0.04) 0%, transparent 70%)", pointerEvents: "none" }} />

      <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
        {/* Ring + play */}
        <div style={{ position: "relative", width: 60, height: 60, flexShrink: 0 }}>
          <svg width={60} height={60} style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
            <circle cx={30} cy={30} r={R} fill="none" stroke="rgba(163,230,53,0.1)" strokeWidth={2} />
            <circle ref={ringRef} cx={30} cy={30} r={R} fill="none" stroke="#a3e635" strokeWidth={2}
              strokeDasharray={circumference} strokeDashoffset={circumference}
              strokeLinecap="round" style={{ filter: "drop-shadow(0 0 4px rgba(163,230,53,0.55))" }}
            />
          </svg>
          <button onClick={toggle}
            style={{ position: "absolute", inset: 0, width: 60, height: 60, borderRadius: "50%", background: isPlaying ? "rgba(163,230,53,0.08)" : "rgba(255,255,255,0.03)", border: "1px solid rgba(163,230,53,0.22)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.2s" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(163,230,53,0.14)")}
            onMouseLeave={e => (e.currentTarget.style.background = isPlaying ? "rgba(163,230,53,0.08)" : "rgba(255,255,255,0.03)")}
          >
            {isPlaying ? <Pause size={17} color="#a3e635" /> : <Play size={17} color="#a3e635" style={{ marginLeft: 2 }} />}
          </button>
        </div>

        {/* Meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
            <span style={{ fontSize: 10, letterSpacing: "0.18em", fontFamily: "var(--font-jetbrains-mono, monospace)", padding: "2px 5px", borderRadius: 3, background: "rgba(163,230,53,0.1)", color: "#a3e635", border: "1px solid rgba(163,230,53,0.2)" }}>
              {track.model === "lyria-3-clip-preview" ? "CLIP" : "PRO"}
            </span>
            <span style={{ fontSize: 12, color: "#71717a", fontFamily: "var(--font-jetbrains-mono, monospace)" }}>{fmt(wavesurfer?.getDuration() ?? 0)}</span>
          </div>
          <p style={{ color: "#c8c8c8", fontSize: 14, lineHeight: 1.4, margin: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {displayName}
          </p>
        </div>

        <button onClick={onDelete}
          style={{ background: "none", border: "none", padding: 6, cursor: "pointer", color: "rgba(239,68,68,0.3)", display: "flex", borderRadius: 8, transition: "color 0.15s", flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget.style.color = "rgba(239,68,68,0.85)")}
          onMouseLeave={e => (e.currentTarget.style.color = "rgba(239,68,68,0.3)")}
          title="Delete track"
        ><Trash2 size={14} /></button>
      </div>

      {/* Waveform */}
      <div style={{ marginTop: 16 }}>
        <div style={{ position: "relative", height: 44 }}>
          <div ref={containerRef} style={{ borderRadius: 3, overflow: "hidden" }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 1.5, opacity: waveReady ? 0 : 1, transition: "opacity 0.35s ease", pointerEvents: "none" }}>
            {Array.from({ length: 48 }, (_, i) => {
              const h = 0.15 + Math.abs(Math.sin(i * 0.38 + 0.6)) * 0.45 + Math.abs(Math.sin(i * 0.13)) * 0.4;
              return <div key={i} style={{ flex: 1, height: `${Math.round(h * 100)}%`, background: "rgba(255,255,255,0.08)", borderRadius: 2, animation: `oscPulse ${0.55 + (i % 7) * 0.08}s ease-in-out ${(i % 11) * 0.045}s infinite alternate` }} />;
            })}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 5 }}>
          <span ref={timeRef} style={{ fontSize: 11, color: "#71717a", fontFamily: "var(--font-jetbrains-mono, monospace)" }}>0:00</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Volume2 size={10} color="#52525b" />
              <input type="range" min={0} max={1} step={0.01} value={volume} onChange={handleVolume} style={{ width: 64, height: 3, accentColor: "#a3e635", cursor: "pointer" }} />
            </div>
            <a href={url} download={`homefield-${track.id.slice(0, 8)}.mp3`}
              style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#71717a", textDecoration: "none", fontFamily: "var(--font-jetbrains-mono, monospace)", letterSpacing: "0.04em", transition: "color 0.15s" }}
              onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = "#a3e635")}
              onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = "#71717a")}
            ><Download size={11} /> DOWNLOAD</a>
          </div>
        </div>
      </div>

      {/* Description */}
      {track.description && (
        <div style={{ marginTop: 14, padding: "8px 12px", background: "rgba(163,230,53,0.025)", borderRadius: 8, borderLeft: "2px solid rgba(163,230,53,0.28)" }}>
          <p style={{ fontSize: 12, color: "#71717a", margin: 0, lineHeight: 1.7 }}>{track.description}</p>
        </div>
      )}

      {/* Lyrics */}
      {track.lyrics && (
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setLyricsOpen(v => !v)}
            style={{ background: "none", border: "none", padding: "4px 0", cursor: "pointer", color: "#71717a", display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontFamily: "var(--font-jetbrains-mono, monospace)", letterSpacing: "0.14em", textTransform: "uppercase", transition: "color 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#a3e635")}
            onMouseLeave={e => (e.currentTarget.style.color = "#71717a")}
          >
            <FileText size={10} /> Lyrics {lyricsOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
          <div style={{ display: "grid", gridTemplateRows: lyricsOpen ? "1fr" : "0fr", transition: "grid-template-rows 0.28s ease" }}>
            <div style={{ overflow: "hidden" }}>
              <pre style={{ fontSize: 13, color: "#909090", lineHeight: 1.85, margin: 0, whiteSpace: "pre-wrap", fontFamily: "var(--font-outfit, sans-serif)", padding: "8px 0 2px" }}>
                {track.lyrics}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Sessions panel ─────────────────────────────────────────── */
export interface MusicSessionsPanelProps {
  tracks: Track[];
  currentTrack: Track | null;
  deletingId: string | null;
  generating: boolean;
  trackDisplayNames: Record<string, string>;
  contextMenuTrack: string | null;
  editingTrackTitle: string | null;
  editingTitleValue: string;
  onLoadTrack: (track: Track) => void;
  onDeleteTrack: (id: string) => void;
  onOpenContextMenu: (trackId: string) => void;
  onCloseContextMenu: () => void;
  onStartEditTitle: (trackId: string, currentName: string) => void;
  onCommitEditTitle: () => void;
  onCancelEditTitle: () => void;
  onEditTitleChange: (v: string) => void;
  onCopyPrompt: (prompt: string) => void;
  isMobile?: boolean;
}

export default function MusicSessionsPanel({
  tracks, currentTrack, deletingId, generating,
  trackDisplayNames, contextMenuTrack, editingTrackTitle, editingTitleValue,
  onLoadTrack, onDeleteTrack, onOpenContextMenu, onCloseContextMenu,
  onStartEditTitle, onCommitEditTitle, onCancelEditTitle, onEditTitleChange,
  onCopyPrompt, isMobile = false,
}: MusicSessionsPanelProps) {

  const getDisplayName = useCallback((t: Track) => trackDisplayNames[t.id] ?? t.prompt, [trackDisplayNames]);

  const handleDownload = useCallback((track: Track) => {
    const a = document.createElement("a");
    a.href = `/api/files/${track.filePath}`;
    a.download = `homefield-${track.id.slice(0, 8)}.mp3`;
    a.click();
  }, []);

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: isMobile ? "auto" : "100%", overflow: isMobile ? "visible" : "hidden",
      background: "var(--surface)",
    }}>
      {/* Panel header */}
      <div style={{
        padding: "14px 22px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, letterSpacing: "0.2em", color: "#71717a", fontFamily: "var(--font-jetbrains-mono, monospace)", textTransform: "uppercase" }}>
          My Studio Sessions
        </span>
        {tracks.length > 0 && (
          <span style={{ fontSize: 11, color: "#52525b", fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
            {tracks.length} track{tracks.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Featured player */}
      <div style={{
        flexShrink: 0,
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(163,230,53,0.01)",
        minHeight: 60,
      }}>
        <AnimatePresence mode="wait">
          {currentTrack ? (
            <motion.div key={currentTrack.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              <Player
                track={currentTrack}
                displayName={getDisplayName(currentTrack)}
                onDelete={() => onDeleteTrack(currentTrack.id)}
              />
            </motion.div>
          ) : (
            <motion.div key="empty-player" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "22px", opacity: generating ? 0.6 : 1 }}
            >
              <div style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Radio size={14} color="#52525b" />
              </div>
              <span style={{ fontSize: 12, color: "#52525b", fontFamily: "var(--font-jetbrains-mono, monospace)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                {generating ? "Composing..." : "No track selected"}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Track list */}
      <div style={{ flex: isMobile ? undefined : 1, overflowY: isMobile ? "visible" : "auto" }} className="scrollbar-thin">
        <LayoutGroup>
          <AnimatePresence initial={false}>
            {tracks.map((t, i) => (
              <motion.div key={t.id} layout="position"
                initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18, delay: i < 6 ? i * 0.018 : 0, layout: { duration: 0.22, ease: [0.22, 0.5, 0.36, 1] } }}
              >
                <TrackRow
                  track={t} index={i}
                  isActive={currentTrack?.id === t.id}
                  isDeleting={deletingId === t.id}
                  displayName={getDisplayName(t)}
                  isEditingTitle={editingTrackTitle === t.id}
                  editingValue={editingTitleValue}
                  contextMenuOpen={contextMenuTrack === t.id}
                  isMobile={isMobile}
                  onLoad={() => onLoadTrack(t)}
                  onDelete={() => onDeleteTrack(t.id)}
                  onOpenContextMenu={() => onOpenContextMenu(t.id)}
                  onCloseContextMenu={onCloseContextMenu}
                  onStartEditTitle={() => onStartEditTitle(t.id, getDisplayName(t))}
                  onCommitEditTitle={onCommitEditTitle}
                  onCancelEditTitle={onCancelEditTitle}
                  onEditTitleChange={onEditTitleChange}
                  onDownload={() => handleDownload(t)}
                  onCopyPrompt={() => onCopyPrompt(t.prompt)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </LayoutGroup>

        {/* Empty state */}
        {tracks.length === 0 && !generating && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, paddingTop: 60 }}
          >
            <div style={{ width: 42, height: 42, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Radio size={16} color="#52525b" />
            </div>
            <span style={{ fontSize: 12, color: "#52525b", fontFamily: "var(--font-jetbrains-mono, monospace)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
              No tracks yet
            </span>
          </motion.div>
        )}
      </div>

      {/* Footer */}
      {tracks.length > 0 && (
        <div style={{ padding: "10px 22px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: "#3f3f46", fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
            {tracks.length} track{tracks.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
