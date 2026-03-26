"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useWavesurfer } from "@wavesurfer/react";
import {
  Play, Pause, Download, Trash2, ArrowLeft,
  ImageIcon, X, ChevronDown, ChevronUp, FileText, Radio,
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

type ModelId = "lyria-3-pro-preview" | "lyria-3-clip-preview";

const MODELS: { id: ModelId; label: string; tag: string }[] = [
  { id: "lyria-3-pro-preview",  label: "PRO",  tag: "≤ 3 min" },
  { id: "lyria-3-clip-preview", label: "CLIP", tag: "short"   },
];

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

/* ─── Oscilloscope waveform ──────────────────────────────────── */
function OscWave() {
  const n = 32;
  const heights = Array.from({ length: n }, (_, i) => {
    const x = (i / n) * Math.PI * 4;
    return 0.18 + 0.52 * Math.abs(Math.sin(x)) + 0.3 * Math.abs(Math.sin(x * 2.4 + 1.1));
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, height: 72 }}>
      {heights.map((h, i) => (
        <div key={i} style={{
          width: 3, height: h * 72,
          background: "linear-gradient(to top, #a3e635, rgba(163,230,53,0.45))",
          borderRadius: 2, transformOrigin: "center",
          boxShadow: "0 0 7px rgba(163,230,53,0.45)",
          animation: `oscPulse ${0.32 + (i % 9) * 0.048}s ease-in-out ${i * 0.018}s infinite alternate`,
        }} />
      ))}
    </div>
  );
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

/* ─── Audio player with circular progress ring ───────────────── */
function Player({ track, onDelete }: { track: Track; onDelete: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const url = `/api/files/${track.filePath}`;

  const [waveReady, setWaveReady] = useState(false);

  const { wavesurfer, isPlaying, currentTime } = useWavesurfer({
    container: containerRef,
    url,
    height: 52,
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

  const duration = wavesurfer?.getDuration() ?? 0;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const R = 30;
  const circumference = 2 * Math.PI * R;
  const dashOffset = circumference * (1 - progress / 100);

  useEffect(() => { setLyricsOpen(false); setWaveReady(false); }, [track.id]);

  useEffect(() => {
    if (!wavesurfer) return;
    const unsub = wavesurfer.on("ready", () => setWaveReady(true));
    return unsub;
  }, [wavesurfer]);

  const toggle = () => wavesurfer?.playPause();

  return (
    <div style={{
      background: "rgba(14,14,14,0.96)",
      border: "1px solid rgba(163,230,53,0.18)",
      borderRadius: 20, padding: "24px 28px",
      boxShadow: "0 0 0 1px rgba(163,230,53,0.05), inset 0 1px 0 rgba(255,255,255,0.04), 0 20px 60px rgba(0,0,0,0.7)",
      position: "relative", overflow: "hidden",
    }}>
      {/* Ambient glow */}
      <div style={{ position: "absolute", top: -60, right: -60, width: 220, height: 220, background: "radial-gradient(circle, rgba(163,230,53,0.055) 0%, transparent 70%)", pointerEvents: "none" }} />

      <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
        {/* Ring + play button */}
        <div style={{ position: "relative", width: 68, height: 68, flexShrink: 0 }}>
          <svg width={68} height={68} style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
            <circle cx={34} cy={34} r={R} fill="none" stroke="rgba(163,230,53,0.1)" strokeWidth={2} />
            <circle cx={34} cy={34} r={R} fill="none" stroke="#a3e635" strokeWidth={2}
              strokeDasharray={circumference} strokeDashoffset={dashOffset}
              strokeLinecap="round"
              style={{ transition: "stroke-dashoffset 0.1s linear", filter: "drop-shadow(0 0 4px rgba(163,230,53,0.55))" }}
            />
          </svg>
          <button onClick={toggle}
            style={{
              position: "absolute", inset: 0, width: 68, height: 68, borderRadius: "50%",
              background: isPlaying ? "rgba(163,230,53,0.08)" : "rgba(255,255,255,0.03)",
              border: "1px solid rgba(163,230,53,0.22)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.2s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(163,230,53,0.14)")}
            onMouseLeave={e => (e.currentTarget.style.background = isPlaying ? "rgba(163,230,53,0.08)" : "rgba(255,255,255,0.03)")}
          >
            {isPlaying
              ? <Pause size={20} color="#a3e635" />
              : <Play  size={20} color="#a3e635" style={{ marginLeft: 3 }} />}
          </button>
        </div>

        {/* Meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
            <span style={{
              fontSize: 9, letterSpacing: "0.18em", fontFamily: "monospace",
              padding: "2px 6px", borderRadius: 3,
              background: "rgba(163,230,53,0.1)", color: "#a3e635",
              border: "1px solid rgba(163,230,53,0.2)",
            }}>{track.model === "lyria-3-clip-preview" ? "CLIP" : "PRO"}</span>
            <span style={{ fontSize: 11, color: "#71717a", fontFamily: "monospace" }}>{fmt(duration)}</span>
          </div>
          <p style={{
            color: "#c8c8c8", fontSize: 14, lineHeight: 1.45, margin: 0,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>{track.prompt}</p>
        </div>

        <button onClick={onDelete}
          style={{ background: "none", border: "none", padding: 6, cursor: "pointer", color: "rgba(239,68,68,0.3)", display: "flex", borderRadius: 8, transition: "color 0.15s", flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget.style.color = "rgba(239,68,68,0.85)")}
          onMouseLeave={e => (e.currentTarget.style.color = "rgba(239,68,68,0.3)")}
          title="Delete track"
        ><Trash2 size={15} /></button>
      </div>

      {/* Real waveform (decoded from audio) */}
      <div style={{ marginTop: 22 }}>
        <div style={{ position: "relative", height: 52 }}>
          <div ref={containerRef} style={{ borderRadius: 3, overflow: "hidden" }} />
          {/* Loading skeleton — fades out once wavesurfer fires 'ready' */}
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 1.5,
            opacity: waveReady ? 0 : 1, transition: "opacity 0.35s ease",
            pointerEvents: "none",
          }}>
            {Array.from({ length: 52 }, (_, i) => {
              const h = 0.15 + Math.abs(Math.sin(i * 0.38 + 0.6)) * 0.45 + Math.abs(Math.sin(i * 0.13)) * 0.4;
              return (
                <div key={i} style={{
                  flex: 1, height: `${Math.round(h * 100)}%`,
                  background: "rgba(255,255,255,0.08)", borderRadius: 2,
                  animation: `oscPulse ${0.55 + (i % 7) * 0.08}s ease-in-out ${(i % 11) * 0.045}s infinite alternate`,
                }} />
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          <span style={{ fontSize: 10, color: "#71717a", fontFamily: "monospace" }}>{fmt(currentTime)}</span>
          <a href={url} download={`homefield-${track.id.slice(0, 8)}.mp3`}
            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#71717a", textDecoration: "none", fontFamily: "monospace", letterSpacing: "0.04em", transition: "color 0.15s" }}
            onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = "#a3e635")}
            onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = "#71717a")}
          ><Download size={12} /> DOWNLOAD</a>
        </div>
      </div>


      {/* Description */}
      {track.description && (
        <div style={{ marginTop: 18, padding: "10px 14px", background: "rgba(163,230,53,0.025)", borderRadius: 10, borderLeft: "2px solid rgba(163,230,53,0.28)" }}>
          <p style={{ fontSize: 12, color: "#71717a", margin: 0, lineHeight: 1.7 }}>{track.description}</p>
        </div>
      )}

      {/* Lyrics */}
      {track.lyrics && (
        <div style={{ marginTop: 14 }}>
          <button onClick={() => setLyricsOpen(v => !v)}
            style={{ background: "none", border: "none", padding: "5px 0", cursor: "pointer", color: "#71717a", display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontFamily: "monospace", letterSpacing: "0.14em", textTransform: "uppercase", transition: "color 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#a3e635")}
            onMouseLeave={e => (e.currentTarget.style.color = "#71717a")}
          >
            <FileText size={11} /> Lyrics
            {lyricsOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          <div style={{
            display: "grid",
            gridTemplateRows: lyricsOpen ? "1fr" : "0fr",
            transition: "grid-template-rows 0.28s ease",
          }}>
            <div style={{ overflow: "hidden" }}>
              <pre style={{ fontSize: 13, color: "#909090", lineHeight: 1.85, margin: 0, whiteSpace: "pre-wrap", fontFamily: "var(--font-outfit, sans-serif)", padding: "10px 0 2px" }}>
                {track.lyrics}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── DAW-style track row ────────────────────────────────────── */
function TrackRow({ track, index, isActive, isDeleting, onLoad, onDelete }: {
  track: Track; index: number; isActive: boolean; isDeleting: boolean;
  onLoad: () => void; onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const seed = parseInt(track.id.slice(0, 4), 16);
  const url  = `/api/files/${track.filePath}`;

  return (
    <div
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onClick={onLoad}
      style={{
        display: "flex", alignItems: "center", gap: 14, padding: "11px 20px",
        background: isActive ? "rgba(163,230,53,0.035)" : hovered ? "rgba(255,255,255,0.04)" : "transparent",
        borderLeft: `2px solid ${isActive ? "#a3e635" : "transparent"}`,
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        cursor: "pointer", transition: "all 0.14s", opacity: isDeleting ? 0.25 : 1,
      }}
    >
      <span style={{ fontSize: 10, color: isActive ? "rgba(163,230,53,0.7)" : "#52525b", fontFamily: "monospace", minWidth: 18, userSelect: "none" }}>
        {String(index + 1).padStart(2, "0")}
      </span>

      <MiniWave active={isActive} seed={seed} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: isActive ? "#d8d8d8" : "#a1a1aa", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", transition: "color 0.14s" }}>
          {track.prompt}
        </div>
      </div>

      <span style={{
        fontSize: 9, letterSpacing: "0.12em", fontFamily: "monospace",
        padding: "1px 5px", borderRadius: 3, flexShrink: 0,
        background: isActive ? "rgba(163,230,53,0.08)" : "rgba(255,255,255,0.03)",
        color: isActive ? "rgba(163,230,53,0.7)" : "#71717a",
        border: `1px solid ${isActive ? "rgba(163,230,53,0.18)" : "rgba(255,255,255,0.05)"}`,
        transition: "all 0.14s",
      }}>
        {track.model === "lyria-3-clip-preview" ? "CLIP" : "PRO"}
      </span>

      <span style={{ fontSize: 10, color: "#52525b", fontFamily: "monospace", flexShrink: 0, minWidth: 22, textAlign: "right" }}>
        {ago(track.timestamp)}
      </span>

      <div style={{ display: "flex", gap: 1, opacity: hovered ? 1 : 0, transition: "opacity 0.14s", flexShrink: 0 }}>
        <a href={url} download={`homefield-${track.id.slice(0, 8)}.mp3`} onClick={e => e.stopPropagation()}
          style={{ padding: 5, color: "#71717a", display: "flex", borderRadius: 5, transition: "color 0.14s", textDecoration: "none" }}
          onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = "#a3e635")}
          onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = "#71717a")}
        ><Download size={13} /></a>
        <button onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{ padding: 5, background: "none", border: "none", cursor: "pointer", color: "rgba(239,68,68,0.35)", display: "flex", borderRadius: 5, transition: "color 0.14s" }}
          onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
          onMouseLeave={e => (e.currentTarget.style.color = "rgba(239,68,68,0.35)")}
        ><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */
export default function MusicPage() {
  const { status } = useSession();
  const router = useRouter();

  const [prompt,        setPrompt]        = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelId>("lyria-3-pro-preview");
  const [generating,    setGenerating]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [currentTrack,  setCurrentTrack]  = useState<Track | null>(null);
  const [tracks,        setTracks]        = useState<Track[]>([]);
  const [deletingId,    setDeletingId]    = useState<string | null>(null);
  const [attachedImage, setAttachedImage] = useState<{ preview: string; base64: string; mimeType: string } | null>(null);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);

  const playerRef   = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Restore draft prompt + image on mount
  useEffect(() => {
    const savedPrompt = localStorage.getItem("music:prompt");
    if (savedPrompt) setPrompt(savedPrompt);
    try {
      const savedImg = sessionStorage.getItem("music:image");
      if (savedImg) {
        const { base64, mimeType } = JSON.parse(savedImg) as { base64: string; mimeType: string };
        setAttachedImage({ base64, mimeType, preview: `data:${mimeType};base64,${base64}` });
      }
    } catch {}
  }, []);

  useEffect(() => { if (status === "unauthenticated") router.push("/login"); }, [status, router]);
  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/tracks").then(r => r.json()).then(d => {
      if (Array.isArray(d.tracks)) setTracks(d.tracks);
    }).catch(() => {});
  }, [status]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 7 * 1024 * 1024) { setError("Image too large (max 7MB)"); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      const img = { preview: dataUrl, base64: dataUrl.split(",")[1], mimeType: file.type };
      setAttachedImage(img);
      try { sessionStorage.setItem("music:image", JSON.stringify({ base64: img.base64, mimeType: img.mimeType })); } catch {}
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const generate = useCallback(async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(), model: selectedModel,
          ...(attachedImage && { imageData: attachedImage.base64, imageMimeType: attachedImage.mimeType }),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Generation failed");
      }
      const { jobId } = await res.json() as { jobId: string };
      await new Promise<void>((resolve, reject) => {
        const es = new EventSource(`/api/generate-music/${jobId}/stream`);
        es.onmessage = e => {
          es.close();
          const data = JSON.parse(e.data) as { status: string; track?: Track; error?: string };
          if (data.status === "done" && data.track) {
            const t = data.track;
            setCurrentTrack(t);
            setTracks(prev => [t, ...prev.filter(x => x.id !== t.id)]);
            setTimeout(() => playerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
            resolve();
          } else reject(new Error(data.error || "Generation failed"));
        };
        es.onerror = () => { es.close(); reject(new Error("Connection lost")); };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [prompt, selectedModel, generating, attachedImage]);

  const deleteTrack = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await fetch(`/api/tracks/${id}`, { method: "DELETE" });
      setTracks(prev => prev.filter(t => t.id !== id));
      if (currentTrack?.id === id) setCurrentTrack(null);
    } finally { setDeletingId(null); }
  }, [currentTrack]);

  if (status === "loading" || status === "unauthenticated") return null;

  const canGenerate = prompt.trim().length > 0 && !generating;

  return (
    <>
      <style>{`
        @keyframes oscPulse {
          from { transform: scaleY(0.08); opacity: 0.25; }
          to   { transform: scaleY(1);    opacity: 1;    }
        }
        .hf-textarea::placeholder { color: #2d2d2d; }
      `}</style>

      <div style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse 900px 700px at 5% 95%, rgba(163,230,53,0.022) 0%, transparent 65%), #0a0a0a",
        color: "#e8e8e8",
        fontFamily: "var(--font-outfit, sans-serif)",
      }}>

        {/* ── Header ── */}
        <header style={{
          position: "sticky", top: 0, zIndex: 50,
          height: 54, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 28px",
          background: "rgba(10,10,10,0.94)", backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Image src="/logo-header.png" alt="HomeField" width={120} height={32} style={{ objectFit: "contain", height: 25, width: "auto" }} />
            <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.07)" }} />
            <span style={{ fontSize: 9, letterSpacing: "0.22em", fontFamily: "monospace", color: "rgba(163,230,53,0.7)", textTransform: "uppercase" }}>
              Music Studio
            </span>
          </div>
          <Link href="/"
            style={{ display: "flex", alignItems: "center", gap: 6, color: "#71717a", textDecoration: "none", fontSize: 11, letterSpacing: "0.06em", fontFamily: "monospace", transition: "color 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#a3e635")}
            onMouseLeave={e => (e.currentTarget.style.color = "#71717a")}
          >
            <ArrowLeft size={12} /> STUDIO
          </Link>
        </header>

        <main style={{ maxWidth: 780, margin: "0 auto", padding: "36px 24px 100px" }}>
          <LayoutGroup>

          {/* ── Compose panel ── */}
          <div style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 16, overflow: "hidden", marginBottom: 18,
          }}>
            {/* Panel header row */}
            <div style={{
              padding: "12px 22px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span style={{ fontSize: 9, letterSpacing: "0.2em", color: "#71717a", fontFamily: "monospace", textTransform: "uppercase" }}>
                Compose
              </span>

              {/* Model selector */}
              <div style={{ display: "flex", gap: 2, padding: 2, background: "rgba(0,0,0,0.3)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)" }}>
                {MODELS.map(m => (
                  <button key={m.id} onClick={() => setSelectedModel(m.id)}
                    style={{ position: "relative", border: "none", background: "none", cursor: "pointer", padding: "5px 13px", borderRadius: 6, display: "flex", alignItems: "center", gap: 6 }}
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
                      <span style={{ fontSize: 10, fontFamily: "monospace", letterSpacing: "0.1em", color: selectedModel === m.id ? "#a3e635" : "#71717a", transition: "color 0.15s" }}>{m.label}</span>
                      <span style={{ fontSize: 9, color: selectedModel === m.id ? "rgba(163,230,53,0.45)" : "#52525b", fontFamily: "monospace" }}>{m.tag}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Textarea */}
            <textarea
              value={prompt} onChange={e => { setPrompt(e.target.value); localStorage.setItem("music:prompt", e.target.value); }}
              placeholder="Describe the music you want to generate — genre, mood, tempo, key, instruments, reference artists..."
              disabled={generating} rows={4}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate(); }}
              className="hf-textarea"
              style={{
                display: "block", width: "100%", background: "transparent", border: "none",
                padding: "20px 22px", color: "#b8b8b8",
                fontFamily: "var(--font-outfit, sans-serif)", fontSize: 15, lineHeight: 1.65,
                resize: "none", outline: "none", boxSizing: "border-box",
                opacity: generating ? 0.35 : 1, transition: "opacity 0.2s",
              }}
            />

            {/* Action bar */}
            <div style={{
              padding: "12px 22px 16px",
              borderTop: "1px solid rgba(255,255,255,0.07)",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" style={{ display: "none" }} onChange={handleImageSelect} />

              <AnimatePresence mode="wait">
                {attachedImage ? (
                  <motion.div key="attached" initial={{ opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.88 }}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px 3px 3px", background: "rgba(163,230,53,0.055)", border: "1px solid rgba(163,230,53,0.14)", borderRadius: 6 }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={attachedImage.preview} alt=""
                      onClick={() => setImagePreviewOpen(true)}
                      style={{ width: 22, height: 22, objectFit: "cover", borderRadius: 4, cursor: "zoom-in" }}
                    />
                    <span
                      onClick={() => setImagePreviewOpen(true)}
                      style={{ fontSize: 10, color: "rgba(163,230,53,0.65)", fontFamily: "monospace", letterSpacing: "0.08em", cursor: "zoom-in" }}
                    >IMG</span>
                    <button onClick={() => { setAttachedImage(null); sessionStorage.removeItem("music:image"); }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "rgba(163,230,53,0.4)", display: "flex", lineHeight: 1 }}>
                      <X size={11} />
                    </button>
                  </motion.div>
                ) : (
                  <motion.button key="add-img" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={() => fileInputRef.current?.click()}
                    style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "5px 10px", color: "#71717a", fontSize: 10, fontFamily: "monospace", letterSpacing: "0.08em", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, transition: "color 0.14s, border-color 0.14s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#a3e635"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(163,230,53,0.2)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#71717a"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.1)"; }}
                  >
                    <ImageIcon size={11} /> IMG
                  </motion.button>
                )}
              </AnimatePresence>

              {(prompt.trim().length > 0 || !!attachedImage) && !generating && (
                <button
                  onClick={() => {
                    setPrompt(""); setAttachedImage(null);
                    localStorage.removeItem("music:prompt");
                    sessionStorage.removeItem("music:image");
                  }}
                  style={{ background: "none", border: "1px solid rgba(239,68,68,0.18)", borderRadius: 6, padding: "5px 8px", color: "rgba(239,68,68,0.45)", cursor: "pointer", display: "flex", alignItems: "center", transition: "color 0.14s, border-color 0.14s" }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.5)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "rgba(239,68,68,0.45)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.18)"; }}
                  title="Clear prompt and image"
                ><Trash2 size={11} /></button>
              )}

              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.1)", fontFamily: "monospace" }}>{!generating && "⌘↵"}</span>

              <button onClick={generate} disabled={!canGenerate}
                style={{
                  background: canGenerate ? "#a3e635" : "rgba(163,230,53,0.1)",
                  color: canGenerate ? "#000" : "rgba(163,230,53,0.28)",
                  border: "none", borderRadius: 8, padding: "9px 22px",
                  fontSize: 12, fontFamily: "var(--font-outfit, sans-serif)", fontWeight: 700,
                  letterSpacing: "0.06em", cursor: canGenerate ? "pointer" : "not-allowed",
                  display: "flex", alignItems: "center", gap: 7, transition: "all 0.15s",
                  boxShadow: canGenerate ? "0 0 18px rgba(163,230,53,0.18)" : "none",
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
                  <><Play size={11} fill="currentColor" style={{ marginLeft: -1 }} /> GENERATE</>
                )}
              </button>
            </div>
          </div>

          {/* ── Error ── */}
          <AnimatePresence>
            {error && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}
                style={{ background: "rgba(239,68,68,0.055)", border: "1px solid rgba(239,68,68,0.14)", borderRadius: 10, padding: "10px 16px", color: "rgba(239,68,68,0.75)", fontSize: 13, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                {error}
                <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(239,68,68,0.35)", display: "flex", padding: 2 }}><X size={13} /></button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Generating state ── */}
          <AnimatePresence>
            {generating && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
                style={{
                  background: "rgba(8,8,8,0.85)", border: "1px solid rgba(163,230,53,0.09)",
                  borderRadius: 16, padding: "32px 28px",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 18,
                  marginBottom: 18, position: "relative", overflow: "hidden",
                }}
              >
                <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center bottom, rgba(163,230,53,0.035) 0%, transparent 65%)", pointerEvents: "none" }} />
                <OscWave />
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, position: "relative" }}>
                  <span style={{ fontSize: 10, color: "rgba(163,230,53,0.55)", fontFamily: "monospace", letterSpacing: "0.18em", textTransform: "uppercase" }}>
                    {selectedModel === "lyria-3-clip-preview" ? "Lyria 3 Clip" : "Lyria 3 Pro"}
                  </span>
                  <span style={{ fontSize: 10, color: "#52525b", fontFamily: "monospace", letterSpacing: "0.1em" }}>composing...</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Player ── */}
          <AnimatePresence>
            {currentTrack && !generating && (
              <motion.div layout="position" ref={playerRef as React.RefObject<HTMLDivElement>}
                initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.38, ease: [0.22, 0.5, 0.36, 1], layout: { duration: 0.3, ease: [0.22, 0.5, 0.36, 1] } }}
                style={{ marginBottom: 28 }}
              >
                <Player track={currentTrack} onDelete={() => deleteTrack(currentTrack.id)} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Session list ── */}
          {tracks.length > 0 && (
            <motion.div layout="position" transition={{ layout: { duration: 0.3, ease: [0.22, 0.5, 0.36, 1] } }} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 14, overflow: "hidden" }}>
              <div style={{ padding: "11px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 9, letterSpacing: "0.2em", color: "#52525b", fontFamily: "monospace", textTransform: "uppercase" }}>Session</span>
                <span style={{ fontSize: 10, color: "#52525b", fontFamily: "monospace" }}>{tracks.length} track{tracks.length !== 1 ? "s" : ""}</span>
              </div>
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
                      onLoad={() => {
                        setCurrentTrack(t);
                        setTimeout(() => playerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
                      }}
                      onDelete={() => deleteTrack(t.id)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}

          {/* ── Empty state ── */}
          {tracks.length === 0 && !generating && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, paddingTop: 80 }}
            >
              <div style={{ width: 42, height: 42, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Radio size={16} color="#52525b" />
              </div>
              <span style={{ fontSize: 10, color: "#52525b", fontFamily: "monospace", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                No tracks yet
              </span>
            </motion.div>
          )}
          </LayoutGroup>

        </main>
      </div>

      {/* Image preview modal */}
      <AnimatePresence>
        {imagePreviewOpen && attachedImage && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setImagePreviewOpen(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 100,
              background: "rgba(0,0,0,0.88)", backdropFilter: "blur(8px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 24,
            }}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 0.5, 0.36, 1] }}
              onClick={e => e.stopPropagation()}
              style={{ position: "relative", maxWidth: "min(720px, 90vw)", maxHeight: "80vh" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachedImage.preview} alt="Reference image"
                style={{ display: "block", maxWidth: "100%", maxHeight: "80vh", objectFit: "contain", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)" }}
              />
              <button
                onClick={() => setImagePreviewOpen(false)}
                style={{
                  position: "absolute", top: -12, right: -12,
                  width: 32, height: 32, borderRadius: "50%",
                  background: "rgba(20,20,20,0.95)", border: "1px solid rgba(255,255,255,0.1)",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#71717a", transition: "color 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.color = "#f5f5f5")}
                onMouseLeave={e => (e.currentTarget.style.color = "#71717a")}
              >
                <X size={14} />
              </button>
              <button
                onClick={() => { setAttachedImage(null); setImagePreviewOpen(false); sessionStorage.removeItem("music:image"); }}
                style={{
                  position: "absolute", bottom: -44, left: "50%", transform: "translateX(-50%)",
                  background: "none", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8,
                  padding: "6px 14px", cursor: "pointer", color: "rgba(239,68,68,0.6)",
                  fontSize: 12, fontFamily: "monospace", letterSpacing: "0.08em",
                  display: "flex", alignItems: "center", gap: 5, transition: "color 0.15s, border-color 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.5)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "rgba(239,68,68,0.6)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.25)"; }}
              >
                <Trash2 size={12} /> REMOVE
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
