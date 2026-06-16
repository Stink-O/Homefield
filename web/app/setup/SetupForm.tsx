"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, Upload } from "lucide-react";

export function SetupForm() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [keyOpen, setKeyOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function handleKeyFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setGoogleKey(typeof reader.result === "string" ? reader.result : "");
      setKeyOpen(true);
    };
    reader.readAsText(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), email: email.trim(), password, confirmPassword: confirm, googleKey: googleKey.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setDone(true);
      } else if (res.status === 403) {
        setError("Setup has already been completed.");
        setTimeout(() => router.push("/login"), 2000);
      } else {
        setError(data.error ?? "Something went wrong.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#a3e635]/10 border border-[#a3e635]/20">
          <CheckCircle2 size={28} className="text-[#a3e635]" />
        </div>
        <div>
          <p className="text-white font-semibold">Admin account created</p>
          <p className="text-white/40 text-sm mt-1 leading-relaxed max-w-[240px]">
            Your account is ready. Sign in to get started.
          </p>
        </div>
        <button
          onClick={() => router.push("/login")}
          className="mt-2 w-full rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-black font-semibold py-3 transition-colors"
        >
          Go to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm text-white/60 font-medium" htmlFor="setup-username">Username</label>
        <input
          id="setup-username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-[#a3e635]/50 focus:ring-1 focus:ring-[#a3e635]/30 transition-colors"
          placeholder="Choose a username"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm text-white/60 font-medium" htmlFor="setup-email">Email</label>
        <input
          id="setup-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-[#a3e635]/50 focus:ring-1 focus:ring-[#a3e635]/30 transition-colors"
          placeholder="Enter your email"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm text-white/60 font-medium" htmlFor="setup-password">Password</label>
        <input
          id="setup-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-[#a3e635]/50 focus:ring-1 focus:ring-[#a3e635]/30 transition-colors"
          placeholder="Choose a password"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm text-white/60 font-medium" htmlFor="setup-confirm">Confirm password</label>
        <input
          id="setup-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-[#a3e635]/50 focus:ring-1 focus:ring-[#a3e635]/30 transition-colors"
          placeholder="Repeat your password"
        />
      </div>
      {/* Optional Google key */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02]">
        <button
          type="button"
          onClick={() => setKeyOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="flex flex-col">
            <span className="text-sm text-white/80 font-medium">Google Cloud key</span>
            <span className="text-xs text-white/30">Needed for media generation. You can add it later.</span>
          </span>
          <ChevronDown
            size={16}
            className="text-white/30 transition-transform duration-200"
            style={{ transform: keyOpen ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        </button>
        {keyOpen && (
          <div className="px-4 pb-4 flex flex-col gap-2">
            <textarea
              value={googleKey}
              onChange={(e) => setGoogleKey(e.target.value)}
              spellCheck={false}
              placeholder='Paste your service-account JSON, or upload the file'
              className="h-24 w-full resize-none rounded-lg bg-white/5 border border-white/10 px-3 py-2 font-mono text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-[#a3e635]/50 transition-colors"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="self-start flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-white/60 hover:text-white transition-colors"
            >
              <Upload size={12} /> Upload .json
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleKeyFile} />
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-400 text-center">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="mt-1 w-full rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-black font-semibold py-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Creating account..." : "Create admin account"}
      </button>
      <p className="text-center text-xs text-white/25">
        This page is only available once and will be disabled after setup.
      </p>
    </form>
  );
}
