"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, User, Lock, Check } from "lucide-react";

export default function AccountPage() {
  const { data: session, update } = useSession();
  const username = session?.user?.name ?? "";

  const [newUsername, setNewUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [usernameDone, setUsernameDone] = useState(false);
  const [usernameLoading, setUsernameLoading] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordDone, setPasswordDone] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

  async function handleUsernameSubmit(e: React.FormEvent) {
    e.preventDefault();
    setUsernameError("");
    setUsernameDone(false);
    if (!newUsername.trim()) return;
    setUsernameLoading(true);
    const res = await fetch("/api/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: newUsername.trim() }),
    });
    setUsernameLoading(false);
    if (res.ok) {
      await update({ name: newUsername.trim() });
      setUsernameDone(true);
      setNewUsername("");
      setTimeout(() => setUsernameDone(false), 3000);
    } else {
      const data = await res.json();
      setUsernameError(data.error ?? "Failed to update username.");
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError("");
    setPasswordDone(false);
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }
    setPasswordLoading(true);
    const res = await fetch("/api/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setPasswordLoading(false);
    if (res.ok) {
      setPasswordDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordDone(false), 3000);
    } else {
      const data = await res.json();
      setPasswordError(data.error ?? "Failed to update password.");
    }
  }

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <div className="max-w-lg mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-center gap-4 mb-10">
          <Link
            href="/"
            className="flex items-center justify-center h-9 w-9 rounded-xl bg-[var(--chrome-surface)] border border-[var(--chrome-border)] text-text-secondary/60 hover:text-text-primary hover:bg-[var(--chrome-surface-hover)] transition-colors"
          >
            <ArrowLeft size={16} />
          </Link>
          <Image src="/logo-header.png" alt="HomeField" width={36} height={36} className="rounded-xl" />
          <div>
            <h1 className="text-lg font-semibold text-text-primary">Account settings</h1>
            <p className="text-xs text-text-secondary/60">Signed in as {username}</p>
          </div>
        </div>

        <div className="flex flex-col gap-5">

          {/* Username */}
          <form onSubmit={handleUsernameSubmit} className="rounded-2xl bg-[var(--chrome-surface)] border border-[var(--chrome-border)] p-6">
            <div className="flex items-center gap-2.5 mb-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--chrome-surface-hover)]">
                <User size={15} className="text-text-secondary" />
              </div>
              <h2 className="text-sm font-semibold text-text-primary">Change username</h2>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-text-secondary/60">Current username</label>
                <div className="rounded-xl bg-[var(--chrome-surface)] border border-[var(--chrome-border)] px-4 py-3 text-sm text-text-secondary/50">
                  {username}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-text-secondary/60" htmlFor="new-username">New username</label>
                <input
                  id="new-username"
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="Enter new username"
                  required
                  className="rounded-xl bg-[var(--chrome-surface)] border border-[var(--chrome-border)] px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-[#a3e635]/50 transition-colors"
                />
              </div>
              {usernameError && <p className="text-sm text-red-400">{usernameError}</p>}
              <button
                type="submit"
                disabled={usernameLoading || !newUsername.trim()}
                className="self-start flex items-center gap-2 rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-black font-semibold px-5 py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {usernameDone ? <><Check size={14} /> Saved</> : usernameLoading ? "Saving..." : "Save username"}
              </button>
            </div>
          </form>

          {/* Password */}
          <form onSubmit={handlePasswordSubmit} className="rounded-2xl bg-[var(--chrome-surface)] border border-[var(--chrome-border)] p-6">
            <div className="flex items-center gap-2.5 mb-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--chrome-surface-hover)]">
                <Lock size={15} className="text-text-secondary" />
              </div>
              <h2 className="text-sm font-semibold text-text-primary">Change password</h2>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-text-secondary/60" htmlFor="current-pw">Current password</label>
                <input
                  id="current-pw"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  required
                  className="rounded-xl bg-[var(--chrome-surface)] border border-[var(--chrome-border)] px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-[var(--chrome-border-strong)] transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-text-secondary/60" htmlFor="new-pw">New password</label>
                <input
                  id="new-pw"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  required
                  className="rounded-xl bg-[var(--chrome-surface)] border border-[var(--chrome-border)] px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-[var(--chrome-border-strong)] transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-text-secondary/60" htmlFor="confirm-pw">Confirm new password</label>
                <input
                  id="confirm-pw"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  required
                  className="rounded-xl bg-[var(--chrome-surface)] border border-[var(--chrome-border)] px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-[var(--chrome-border-strong)] transition-colors"
                />
              </div>
              {passwordError && <p className="text-sm text-red-400">{passwordError}</p>}
              <button
                type="submit"
                disabled={passwordLoading || !currentPassword || !newPassword || !confirmPassword}
                className="self-start flex items-center gap-2 rounded-xl bg-[var(--chrome-surface-hover)] hover:bg-[var(--border)] border border-[var(--chrome-border)] text-text-primary font-semibold px-5 py-2.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {passwordDone ? <><Check size={14} /> Saved</> : passwordLoading ? "Saving..." : "Save password"}
              </button>
            </div>
          </form>

        </div>
      </div>
    </div>
  );
}
