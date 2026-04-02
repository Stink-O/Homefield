"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

export function SetupForm() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const router = useRouter();

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
        body: JSON.stringify({ username: username.trim(), email: email.trim(), password, confirmPassword: confirm }),
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
