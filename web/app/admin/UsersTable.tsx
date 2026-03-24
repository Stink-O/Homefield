"use client";

import { useEffect, useState } from "react";
import { Trash2, UserCheck, ShieldCheck, User, Check, X, Clock, Pencil } from "lucide-react";

interface UserRecord {
  id: string;
  username: string;
  email: string | null;
  role: "admin" | "user";
  approved: boolean;
  createdAt: number;
}

export function UsersTable() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  async function load() {
    const res = await fetch("/api/admin/users");
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function approve(user: UserRecord) {
    await fetch(`/api/admin/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: true }),
    });
    load();
  }

  async function deny(user: UserRecord) {
    await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
    load();
  }

  async function toggleApproved(user: UserRecord) {
    await fetch(`/api/admin/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: !user.approved }),
    });
    load();
  }

  async function toggleRole(user: UserRecord) {
    await fetch(`/api/admin/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: user.role === "admin" ? "user" : "admin" }),
    });
    load();
  }

  async function deleteUser(id: string, username: string) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    load();
  }

  async function createUser() {
    if (!newUsername.trim() || !newPassword.trim()) {
      setError("Username and password are required.");
      return;
    }
    setCreating(true);
    setError("");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: newUsername.trim(), password: newPassword, role: newRole, approved: true }),
    });
    setCreating(false);
    if (res.ok) {
      setNewUsername("");
      setNewPassword("");
      setNewRole("user");
      load();
    } else {
      const data = await res.json();
      setError(data.error ?? "Failed to create user.");
    }
  }

  function startEdit(user: UserRecord) {
    setEditingId(user.id);
    setEditUsername(user.username);
    setEditPassword("");
    setEditError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditUsername("");
    setEditPassword("");
    setEditError("");
  }

  async function saveEdit(user: UserRecord) {
    if (!editUsername.trim()) {
      setEditError("Username cannot be empty.");
      return;
    }
    setEditSaving(true);
    setEditError("");
    const body: Record<string, string> = {};
    if (editUsername.trim() !== user.username) body.username = editUsername.trim();
    if (editPassword) body.password = editPassword;
    if (Object.keys(body).length === 0) { cancelEdit(); setEditSaving(false); return; }
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setEditSaving(false);
    if (res.ok) {
      cancelEdit();
      load();
    } else {
      const data = await res.json();
      setEditError(data.error ?? "Failed to save changes.");
    }
  }

  if (loading) {
    return <div className="text-text-secondary/40 text-sm">Loading...</div>;
  }

  const pending = users.filter((u) => !u.approved);
  const active = users.filter((u) => u.approved);

  return (
    <div className="flex flex-col gap-8">

      {/* Pending approvals */}
      {pending.length > 0 && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 sm:px-6 py-4 border-b border-amber-500/15">
            <Clock size={14} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-amber-300 uppercase tracking-wider">
              Pending Approval ({pending.length})
            </h2>
          </div>
          <div className="divide-y divide-amber-500/10">
            {pending.map((user) => (
              <div key={user.id} className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 shrink-0 rounded-full bg-amber-500/15 border border-amber-500/20 flex items-center justify-center text-sm font-semibold text-amber-300">
                    {user.username[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{user.username}</p>
                    <p className="text-xs text-text-secondary/50 mt-0.5">
                      Requested {new Date(user.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => approve(user)}
                    className="flex items-center gap-1.5 rounded-xl bg-[#a3e635]/15 border border-[#a3e635]/25 px-2.5 sm:px-4 py-1.5 text-sm font-medium text-[#a3e635] hover:bg-[#a3e635]/25 transition-colors"
                  >
                    <Check size={13} />
                    <span className="hidden sm:inline">Approve</span>
                  </button>
                  <button
                    onClick={() => deny(user)}
                    className="flex items-center gap-1.5 rounded-xl bg-red-500/10 border border-red-500/20 px-2.5 sm:px-4 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/20 transition-colors"
                  >
                    <X size={13} />
                    <span className="hidden sm:inline">Deny</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create account */}
      <div className="rounded-2xl bg-[var(--chrome-surface)] border border-[var(--chrome-border)] p-6">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">Create Account</h2>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              className="flex-1 rounded-xl bg-[var(--chrome-surface)] border border-[var(--chrome-border)] px-4 py-2.5 text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-[#a3e635]/50 text-sm"
            />
            <input
              type="password"
              placeholder="Password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="flex-1 rounded-xl bg-[var(--chrome-surface)] border border-[var(--chrome-border)] px-4 py-2.5 text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-[#a3e635]/50 text-sm"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "user" | "admin")}
              className="rounded-xl bg-[var(--chrome-surface)] border border-[var(--chrome-border)] px-4 py-2.5 text-text-primary focus:outline-none focus:border-[#a3e635]/50 text-sm"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            onClick={createUser}
            disabled={creating}
            className="self-start rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-black font-semibold px-5 py-2.5 text-sm transition-colors disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create Account"}
          </button>
        </div>
      </div>

      {/* Active accounts */}
      <div className="rounded-2xl bg-[var(--chrome-surface)] border border-[var(--chrome-border)] overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-[var(--chrome-border)]">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
            Active Accounts ({active.length})
          </h2>
        </div>
        {active.length === 0 ? (
          <div className="px-6 py-8 text-center text-text-secondary/40 text-sm">No active accounts yet.</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {active.map((user) => (
              <div key={user.id} className="flex flex-col">
                <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 shrink-0 rounded-full bg-[var(--chrome-surface-hover)] flex items-center justify-center text-xs font-semibold text-text-secondary">
                      {user.username[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{user.username}</p>
                      <p className="text-xs text-text-secondary/50 mt-0.5">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      user.role === "admin"
                        ? "bg-[#a3e635]/15 text-[#a3e635]"
                        : "bg-[var(--chrome-surface-hover)] text-text-secondary/60"
                    }`}>
                      {user.role}
                    </span>
                    <button
                      onClick={() => editingId === user.id ? cancelEdit() : startEdit(user)}
                      title="Edit username or password"
                      className={`p-1.5 rounded-lg transition-colors ${editingId === user.id ? "bg-[#a3e635]/15 text-[#a3e635]" : "hover:bg-[var(--chrome-surface-hover)] text-text-secondary/50 hover:text-text-primary"}`}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => toggleApproved(user)}
                      title="Deactivate account"
                      className="p-1.5 rounded-lg hover:bg-[var(--chrome-surface-hover)] text-text-secondary/50 hover:text-amber-400 transition-colors"
                    >
                      <UserCheck size={14} />
                    </button>
                    <button
                      onClick={() => toggleRole(user)}
                      title={user.role === "admin" ? "Demote to user" : "Promote to admin"}
                      className="p-1.5 rounded-lg hover:bg-[var(--chrome-surface-hover)] text-text-secondary/50 hover:text-text-primary transition-colors"
                    >
                      {user.role === "admin" ? <User size={14} /> : <ShieldCheck size={14} />}
                    </button>
                    <button
                      onClick={() => deleteUser(user.id, user.username)}
                      title="Delete user"
                      className="p-1.5 rounded-lg hover:bg-red-500/20 text-text-secondary/50 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {editingId === user.id && (
                  <div className="px-4 sm:px-6 pb-4 flex flex-col gap-3 border-t border-[var(--chrome-border)] pt-4">
                    <div className="flex flex-col sm:flex-row gap-3">
                      <input
                        type="text"
                        placeholder="Username"
                        value={editUsername}
                        onChange={(e) => setEditUsername(e.target.value)}
                        className="flex-1 rounded-xl bg-[var(--chrome-surface)] border border-[var(--chrome-border)] px-4 py-2.5 text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-[#a3e635]/50 text-sm"
                      />
                      <input
                        type="password"
                        placeholder="New password (leave blank to keep)"
                        value={editPassword}
                        onChange={(e) => setEditPassword(e.target.value)}
                        className="flex-1 rounded-xl bg-[var(--chrome-surface)] border border-[var(--chrome-border)] px-4 py-2.5 text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-[#a3e635]/50 text-sm"
                      />
                    </div>
                    {editError && <p className="text-sm text-red-400">{editError}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEdit(user)}
                        disabled={editSaving}
                        className="rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-black font-semibold px-4 py-2 text-sm transition-colors disabled:opacity-50"
                      >
                        {editSaving ? "Saving..." : "Save"}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="rounded-xl bg-[var(--chrome-surface-hover)] px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
