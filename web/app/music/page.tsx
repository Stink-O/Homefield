"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Settings } from "lucide-react";
import { X } from "lucide-react";
import MusicComposePanel from "@/components/MusicComposePanel";
import MusicSessionsPanel from "@/components/MusicSessionsPanel";

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
type DurationPreset = 30 | 60 | 180 | 240;

interface AttachedImage { preview: string; base64: string; mimeType: string; }

export default function MusicPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Compose state
  const [prompt,        setPrompt]        = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelId>("lyria-3-pro-preview");
  const [selectedDuration, setSelectedDuration] = useState<DurationPreset>(60);

  const handleSetModel = useCallback((m: ModelId) => {
    setSelectedModel(m);
    if (m === "lyria-3-clip-preview") setSelectedDuration(30);
  }, []);
  const [negativePrompt, setNegativePrompt] = useState("");
  const [bpm, setBpm] = useState<number | "">("");
  const [intensity, setIntensity] = useState(0.5);
  const [instrumentalMode, setInstrumentalMode] = useState(false);
  const [userLyrics, setUserLyrics] = useState("");
  const [watermark, setWatermark] = useState(true);
  const [inputFiltering, setInputFiltering] = useState(true);
  const [outputFilteringRecitation, setOutputFilteringRecitation] = useState(true);
  const [outputFilteringVocalLikeness, setOutputFilteringVocalLikeness] = useState(true);
  const [promptRewriter, setPromptRewriter] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track/session state
  const [currentTrack,  setCurrentTrack]  = useState<Track | null>(null);
  const [tracks,        setTracks]        = useState<Track[]>([]);
  const [deletingId,    setDeletingId]    = useState<string | null>(null);

  // Context menu + title editing
  const [contextMenuTrack, setContextMenuTrack] = useState<string | null>(null);
  const [editingTrackTitle, setEditingTrackTitle] = useState<string | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState("");
  const [trackDisplayNames, setTrackDisplayNames] = useState<Record<string, string>>({});

  const [mobileTab, setMobileTab] = useState<"compose" | "sessions">("compose");
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const username = session?.user?.name ?? "";
  const userRole = (session?.user as { role?: string } | undefined)?.role ?? "";

  // Restore draft prompt + image
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

  // Load display name overrides from localStorage
  useEffect(() => {
    if (!session?.user) return;
    const userId = (session.user as { id?: string }).id ?? "user";
    try {
      const raw = localStorage.getItem(`track-titles-${userId}`);
      if (raw) setTrackDisplayNames(JSON.parse(raw));
    } catch {}
  }, [session]);

  useEffect(() => { if (status === "unauthenticated") router.push("/login"); }, [status, router]);
  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/tracks").then(r => r.json()).then(d => {
      if (Array.isArray(d.tracks)) setTracks(d.tracks);
    }).catch(() => {});
  }, [status]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
          prompt: prompt.trim(),
          model: selectedModel,
          ...(attachedImage && { imageData: attachedImage.base64, imageMimeType: attachedImage.mimeType }),
          negativePrompt: negativePrompt.trim() || undefined,
          duration: selectedDuration,
          bpm: bpm !== "" ? Number(bpm) : undefined,
          intensity,
          instrumentalMode,
          userLyrics: !instrumentalMode && userLyrics.trim() ? userLyrics.trim() : undefined,
          watermark,
          inputFiltering,
          outputFilteringRecitation,
          outputFilteringVocalLikeness,
          promptRewriter,
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
  }, [prompt, selectedModel, generating, attachedImage, negativePrompt, selectedDuration, bpm, intensity, instrumentalMode, userLyrics, watermark, inputFiltering, outputFilteringRecitation, outputFilteringVocalLikeness, promptRewriter]);

  const deleteTrack = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await fetch(`/api/tracks/${id}`, { method: "DELETE" });
      setTracks(prev => prev.filter(t => t.id !== id));
      if (currentTrack?.id === id) setCurrentTrack(null);
    } finally { setDeletingId(null); }
  }, [currentTrack]);

  const handleClear = useCallback(() => {
    setPrompt(""); setAttachedImage(null);
    setNegativePrompt(""); setSelectedDuration(60); setBpm(""); setIntensity(0.5);
    setInstrumentalMode(false); setUserLyrics("");
    setWatermark(true); setInputFiltering(true);
    setOutputFilteringRecitation(true); setOutputFilteringVocalLikeness(true);
    setPromptRewriter(true); setAdvancedOpen(false);
    localStorage.removeItem("music:prompt");
    sessionStorage.removeItem("music:image");
  }, []);

  const handleCopyPrompt = useCallback((p: string) => {
    navigator.clipboard.writeText(p).catch(() => {});
  }, []);

  const commitTrackTitle = useCallback(() => {
    if (!editingTrackTitle) { setEditingTrackTitle(null); return; }
    const userId = (session?.user as { id?: string })?.id ?? "user";
    const updated = { ...trackDisplayNames };
    if (editingTitleValue.trim()) {
      updated[editingTrackTitle] = editingTitleValue.trim();
    } else {
      delete updated[editingTrackTitle];
    }
    setTrackDisplayNames(updated);
    try { localStorage.setItem(`track-titles-${userId}`, JSON.stringify(updated)); } catch {}
    setEditingTrackTitle(null);
  }, [editingTrackTitle, editingTitleValue, trackDisplayNames, session]);

  if (status === "loading" || status === "unauthenticated") return null;

  return (
    <>
      <div style={{ height: isMobile ? "auto" : "100dvh", minHeight: isMobile ? "100dvh" : undefined, display: "flex", flexDirection: "column", color: "var(--text-primary)", fontFamily: "var(--font-outfit, sans-serif)", overflow: isMobile ? "visible" : "hidden" }}>

        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
          style={{ flexShrink: 0, height: 56, background: "var(--surface)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", zIndex: 50 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Image src="/logo-header.png" alt="HomeField" width={36} height={36} style={{ borderRadius: 8, width: 36, height: 36, objectFit: "cover", flexShrink: 0 }} />
            {!isMobile && <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--text-primary)" }}>HomeField</span>}
            <span style={{ fontSize: isMobile ? 10 : 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-secondary)" }}>Music Studio</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 2 : 6 }}>
            <Link href="/"
              style={{ display: "flex", alignItems: "center", gap: 5, borderRadius: 8, padding: isMobile ? "6px 8px" : "6px 14px", fontSize: 13, fontWeight: 500, color: "rgba(113,113,122,0.6)", textDecoration: "none", transition: "color 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--text-secondary)")}
              onMouseLeave={e => (e.currentTarget.style.color = "rgba(113,113,122,0.6)")}
            >
              <ArrowLeft size={12} />{!isMobile && " Studio"}
            </Link>

            {username && (
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(163,230,53,0.12)", border: "1px solid rgba(163,230,53,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#a3e635", flexShrink: 0, userSelect: "none" }}>
                {username[0].toUpperCase()}
              </div>
            )}

            <Link href="/account"
              style={{ display: "flex", alignItems: "center", padding: 7, borderRadius: 7, color: "#52525b", textDecoration: "none", transition: "color 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#a1a1aa")}
              onMouseLeave={e => (e.currentTarget.style.color = "#52525b")}
            >
              <Settings size={15} />
            </Link>

            {userRole === "admin" && !isMobile && (
              <Link href="/admin"
                style={{ fontSize: 11, fontFamily: "var(--font-jetbrains-mono, monospace)", letterSpacing: "0.1em", padding: "4px 10px", borderRadius: 6, background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24", textDecoration: "none", transition: "all 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(251,191,36,0.18)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(251,191,36,0.1)"; }}
              >
                ADMIN
              </Link>
            )}
          </div>
        </motion.header>

        {/* Mobile tab bar */}
        {isMobile && (
          <div style={{ display: "flex", flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,0.08)", background: "var(--surface)" }}>
            {(["compose", "sessions"] as const).map(tab => (
              <button key={tab} onClick={() => setMobileTab(tab)} style={{
                flex: 1, padding: "10px 0", background: "none", border: "none", cursor: "pointer",
                fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase",
                fontFamily: "var(--font-jetbrains-mono, monospace)",
                color: mobileTab === tab ? "#a3e635" : "#52525b",
                borderBottom: mobileTab === tab ? "2px solid #a3e635" : "2px solid transparent",
                transition: "color 0.15s",
              }}>
                {tab === "compose" ? "Compose" : "Sessions"}
              </button>
            ))}
          </div>
        )}

        {/* Two-panel grid */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.32, ease: [0.22, 0.5, 0.36, 1] }}
          style={{
            flex: isMobile ? undefined : 1,
            display: isMobile ? "block" : "grid",
            gridTemplateColumns: "45fr 55fr",
            overflow: isMobile ? "visible" : "hidden",
            minHeight: isMobile ? undefined : 0,
          }}
        >
          <div style={{ display: isMobile && mobileTab !== "compose" ? "none" : "flex", flexDirection: "column", height: isMobile ? "auto" : "100%", overflow: isMobile ? "visible" : "hidden", borderRight: isMobile ? "none" : "1px solid rgba(255,255,255,0.07)" }}>
          <MusicComposePanel
            prompt={prompt} setPrompt={setPrompt}
            selectedModel={selectedModel} setSelectedModel={handleSetModel}
            selectedDuration={selectedDuration} setSelectedDuration={setSelectedDuration}
            negativePrompt={negativePrompt} setNegativePrompt={setNegativePrompt}
            bpm={bpm} setBpm={setBpm}
            intensity={intensity} setIntensity={setIntensity}
            instrumentalMode={instrumentalMode} setInstrumentalMode={setInstrumentalMode}
            userLyrics={userLyrics} setUserLyrics={setUserLyrics}
            watermark={watermark} setWatermark={setWatermark}
            inputFiltering={inputFiltering} setInputFiltering={setInputFiltering}
            outputFilteringRecitation={outputFilteringRecitation} setOutputFilteringRecitation={setOutputFilteringRecitation}
            outputFilteringVocalLikeness={outputFilteringVocalLikeness} setOutputFilteringVocalLikeness={setOutputFilteringVocalLikeness}
            promptRewriter={promptRewriter} setPromptRewriter={setPromptRewriter}
            advancedOpen={advancedOpen} setAdvancedOpen={setAdvancedOpen}
            attachedImage={attachedImage}
            onAttachImage={() => fileInputRef.current?.click()}
            onRemoveImage={() => { setAttachedImage(null); sessionStorage.removeItem("music:image"); }}
            onPreviewImage={() => setImagePreviewOpen(true)}
            generating={generating}
            onGenerate={generate}
            onClear={handleClear}
            error={error}
            onClearError={() => setError(null)}
            fileInputRef={fileInputRef}
            onFileChange={handleFileChange}
            isMobile={isMobile}
          />
          </div>

          <div style={{ display: isMobile && mobileTab !== "sessions" ? "none" : "flex", flexDirection: "column", height: isMobile ? "auto" : "100%", overflow: isMobile ? "visible" : "hidden" }}>
          <MusicSessionsPanel
            tracks={tracks}
            currentTrack={currentTrack}
            deletingId={deletingId}
            generating={generating}
            trackDisplayNames={trackDisplayNames}
            contextMenuTrack={contextMenuTrack}
            editingTrackTitle={editingTrackTitle}
            editingTitleValue={editingTitleValue}
            onLoadTrack={t => setCurrentTrack(t)}
            onDeleteTrack={deleteTrack}
            onOpenContextMenu={id => setContextMenuTrack(id)}
            onCloseContextMenu={() => setContextMenuTrack(null)}
            onStartEditTitle={(id, name) => { setEditingTrackTitle(id); setEditingTitleValue(name); setContextMenuTrack(null); }}
            onCommitEditTitle={commitTrackTitle}
            onCancelEditTitle={() => setEditingTrackTitle(null)}
            onEditTitleChange={v => setEditingTitleValue(v)}
            onCopyPrompt={handleCopyPrompt}
            isMobile={isMobile}
          />
          </div>
        </motion.div>
      </div>

      {/* Image preview modal */}
      <AnimatePresence>
        {imagePreviewOpen && attachedImage && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            onClick={() => setImagePreviewOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 0.5, 0.36, 1] }}
              onClick={e => e.stopPropagation()}
              style={{ position: "relative", maxWidth: "min(720px, 90vw)", maxHeight: "80vh" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={attachedImage.preview} alt="Reference image" style={{ display: "block", maxWidth: "100%", maxHeight: "80vh", objectFit: "contain", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)" }} />
              <button
                onClick={() => setImagePreviewOpen(false)}
                style={{ position: "absolute", top: -12, right: -12, width: 32, height: 32, borderRadius: "50%", background: "rgba(20,20,20,0.95)", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#71717a", transition: "color 0.15s" }}
                onMouseEnter={e => (e.currentTarget.style.color = "#f5f5f5")}
                onMouseLeave={e => (e.currentTarget.style.color = "#71717a")}
              >
                <X size={14} />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
