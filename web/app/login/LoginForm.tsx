"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

export function LoginForm() {
  const [tab, setTab] = useState<"signin" | "register">("signin");
  const router = useRouter();

  return (
    <div>
      {/* Tab toggle */}
      <div className="flex rounded-xl bg-white/5 border border-white/10 p-1 mb-6">
        <button
          onClick={() => setTab("signin")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all duration-150 ${
            tab === "signin"
              ? "bg-[#a3e635] text-black"
              : "text-white/50 hover:text-white"
          }`}
        >
          Sign in
        </button>
        <button
          onClick={() => setTab("register")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all duration-150 ${
            tab === "register"
              ? "bg-white/10 text-white"
              : "text-white/50 hover:text-white"
          }`}
        >
          Request access
        </button>
      </div>

      {tab === "signin" ? <SignInForm router={router} /> : <RegisterForm onDone={() => setTab("signin")} />}
    </div>
  );
}

function SignInForm({ router }: { router: ReturnType<typeof useRouter> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await signIn("credentials", { username, password, redirect: false });
    setLoading(false);
    if (result?.error) {
      setError("Invalid username or password, or account not yet approved.");
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm text-white/60 font-medium" htmlFor="username">Username</label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-[#a3e635]/50 focus:ring-1 focus:ring-[#a3e635]/30 transition-colors"
          placeholder="Enter your username"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm text-white/60 font-medium" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-[#a3e635]/50 focus:ring-1 focus:ring-[#a3e635]/30 transition-colors"
          placeholder="Enter your password"
        />
      </div>
      {error && <p className="text-sm text-red-400 text-center">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="mt-1 w-full rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-black font-semibold py-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

function RegisterForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim(), password }),
    });
    setLoading(false);
    if (res.ok) {
      setDone(true);
    } else {
      const data = await res.json();
      setError(data.error ?? "Something went wrong.");
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#a3e635]/10 border border-[#a3e635]/20">
          <CheckCircle2 size={28} className="text-[#a3e635]" />
        </div>
        <div>
          <p className="text-white font-semibold">Request sent</p>
          <p className="text-white/40 text-sm mt-1 leading-relaxed max-w-[240px]">
            An admin will review your account. Once approved you can sign in.
          </p>
        </div>
        <button
          onClick={onDone}
          className="mt-2 text-sm text-white/40 hover:text-white/70 transition-colors underline underline-offset-4"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm text-white/60 font-medium" htmlFor="reg-username">Username</label>
        <input
          id="reg-username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/10 transition-colors"
          placeholder="Choose a username"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm text-white/60 font-medium" htmlFor="reg-password">Password</label>
        <input
          id="reg-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/10 transition-colors"
          placeholder="Choose a password"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm text-white/60 font-medium" htmlFor="reg-confirm">Confirm password</label>
        <input
          id="reg-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/10 transition-colors"
          placeholder="Repeat your password"
        />
      </div>
      {error && <p className="text-sm text-red-400 text-center">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="mt-1 w-full rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white font-semibold py-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Sending request..." : "Request access"}
      </button>
      <p className="text-center text-xs text-white/25">
        Your account will be active once an admin approves it.
      </p>
    </form>
  );
}
