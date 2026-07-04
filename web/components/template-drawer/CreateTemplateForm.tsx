"use client";

import { useEffect, useRef, useState } from "react";
import { X, Upload } from "lucide-react";
import { type UserTemplate } from "@/lib/storage";
import { processImageFile } from "./constants";

// New-template form. Mounted only while the create view is open, so all form
// state resets naturally on close.
export default function CreateTemplateForm({
  scrollRef,
  onCancel,
  onSaved,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onCancel: () => void;
  onSaved: (template: UserTemplate) => void;
}) {
  const [formTitle, setFormTitle]             = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formContent, setFormContent]         = useState("");
  const [formImage, setFormImage]             = useState<string | null>(null);
  const [formErrors, setFormErrors]           = useState<{ title?: string; content?: string; image?: string }>({});
  const [dragOver, setDragOver]               = useState(false);
  const [saving, setSaving]                   = useState(false);
  const fileInputRef                          = useRef<HTMLInputElement>(null);

  // Paste handler for the image zone
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) processImageFile(file).then(setFormImage);
          break;
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  function handleImageFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    processImageFile(file).then((url) => {
      setFormImage(url);
      setFormErrors((prev) => ({ ...prev, image: undefined }));
    });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  }

  async function handleSaveTemplate() {
    const errors: { title?: string; content?: string; image?: string } = {};
    const title   = formTitle.trim();
    const content = formContent.trim();
    if (title.length < 3)    errors.title   = "Title must be at least 3 characters";
    if (content.length < 20) errors.content = "Prompt must be at least 20 characters";
    if (!formImage)          errors.image   = "An image is required";
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const body: Record<string, string> = { title, description: formDescription.trim(), content };
      const match = formImage!.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        body.thumbnailMimeType = match[1];
        body.thumbnailBase64 = match[2];
      }
      const res = await fetch("/api/user-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save template");
      const saved = await res.json() as { id: string; title: string; description: string; content: string; thumbnailUrl: string | null; createdAt: number };
      onSaved({
        id: saved.id,
        title: saved.title,
        description: saved.description,
        content: saved.content,
        thumbnail: saved.thumbnailUrl ?? formImage!,
        createdAt: saved.createdAt,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
      <div className="max-w-xl mx-auto space-y-5">

        {/* Image upload zone */}
        <div>
          <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Image <span className="text-[#a3e635]">*</span>
          </label>
          <div
            className={`relative rounded-xl border-2 border-dashed overflow-hidden transition-all duration-150 cursor-pointer ${
              dragOver
                ? "border-[#a3e635]/60 bg-[#a3e635]/5"
                : formErrors.image
                ? "border-red-500/50 bg-red-500/5"
                : "border-[var(--chrome-border)] bg-[var(--chrome-surface)] hover:border-[var(--chrome-border-strong)] hover:bg-[var(--chrome-surface)]"
            }`}
            style={{ aspectRatio: "16/9" }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !formImage && fileInputRef.current?.click()}
          >
            {formImage ? (
              <div className="relative w-full h-full group/img">
                <img src={formImage} alt="Template preview" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/40 transition-colors flex items-center justify-center">
                  <button
                    onClick={(e) => { e.stopPropagation(); setFormImage(null); }}
                    className="opacity-0 group-hover/img:opacity-100 flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-xs text-white transition-opacity"
                  >
                    <X size={12} /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-secondary/50 pointer-events-none">
                <Upload size={22} className={dragOver ? "text-[#a3e635]" : ""} />
                <p className="text-sm font-medium">Click to upload or drag and drop</p>
                <p className="text-xs text-text-secondary/30">Or paste an image (Ctrl+V) — including generated images</p>
              </div>
            )}
          </div>
          {formErrors.image && <p className="mt-1.5 text-xs text-red-400">{formErrors.image}</p>}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImageFile(file);
              e.target.value = "";
            }}
          />
        </div>

        {/* Title */}
        <div>
          <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Title <span className="text-[#a3e635]">*</span>
          </label>
          <input
            type="text"
            value={formTitle}
            onChange={(e) => {
              if (e.target.value.length <= 60) {
                setFormTitle(e.target.value);
                if (formErrors.title) setFormErrors((p) => ({ ...p, title: undefined }));
              }
            }}
            placeholder="Give your template a name"
            className={`w-full rounded-lg border bg-[var(--chrome-surface)] px-4 py-2.5 text-sm text-text-primary placeholder-text-secondary/40 outline-none transition-colors ${
              formErrors.title ? "border-red-500/50 focus:border-red-500/70" : "border-[var(--chrome-border)] focus:border-[var(--chrome-border-strong)]"
            }`}
          />
          <div className="flex justify-between mt-1">
            {formErrors.title
              ? <p className="text-xs text-red-400">{formErrors.title}</p>
              : <span />
            }
            <span className="text-[11px] text-text-secondary/40 tabular-nums">{formTitle.length}/60</span>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Description <span className="text-text-secondary/40 font-normal normal-case tracking-normal">optional</span>
          </label>
          <input
            type="text"
            value={formDescription}
            onChange={(e) => {
              if (e.target.value.length <= 150) setFormDescription(e.target.value);
            }}
            placeholder="What does this template do?"
            className="w-full rounded-lg border border-[var(--chrome-border)] bg-[var(--chrome-surface)] px-4 py-2.5 text-sm text-text-primary placeholder-text-secondary/40 outline-none focus:border-[var(--chrome-border-strong)] transition-colors"
          />
          <div className="flex justify-end mt-1">
            <span className="text-[11px] text-text-secondary/40 tabular-nums">{formDescription.length}/150</span>
          </div>
        </div>

        {/* Prompt content */}
        <div>
          <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
            Prompt <span className="text-[#a3e635]">*</span>
          </label>
          <textarea
            value={formContent}
            onChange={(e) => {
              setFormContent(e.target.value);
              if (formErrors.content && e.target.value.trim().length >= 20)
                setFormErrors((p) => ({ ...p, content: undefined }));
            }}
            placeholder="The full prompt text that will be loaded into the command bar..."
            rows={6}
            className={`w-full rounded-lg border bg-[var(--chrome-surface)] px-4 py-3 text-sm text-text-primary placeholder-text-secondary/40 outline-none resize-none transition-colors leading-relaxed ${
              formErrors.content ? "border-red-500/50 focus:border-red-500/70" : "border-[var(--chrome-border)] focus:border-[var(--chrome-border-strong)]"
            }`}
          />
          <div className="flex justify-between mt-1">
            {formErrors.content
              ? <p className="text-xs text-red-400">{formErrors.content}</p>
              : <span className="text-xs text-text-secondary/40">Minimum 20 characters</span>
            }
            <span className="text-[11px] text-text-secondary/40 tabular-nums">{formContent.length}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-[var(--chrome-border)] bg-[var(--chrome-surface)] hover:bg-[var(--chrome-surface-hover)] px-5 py-2.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveTemplate}
            disabled={saving}
            className="flex-1 rounded-lg bg-[#a3e635] hover:bg-[#bef264] disabled:opacity-50 px-5 py-2.5 text-sm font-semibold text-black transition-colors"
          >
            {saving ? "Saving..." : "Save Template"}
          </button>
        </div>
      </div>
    </div>
  );
}
