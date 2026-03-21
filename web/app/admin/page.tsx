import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { UsersTable } from "./UsersTable";

export default async function AdminPage() {
  const session = await auth();
  if (!session || (session.user as { role?: string }).role !== "admin") {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-bg text-text-primary px-4 py-6 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-text-primary">User Management</h1>
            <p className="text-text-secondary/60 text-sm mt-1">Manage HomeField accounts</p>
          </div>
          <a
            href="/"
            className="self-start flex items-center gap-2 rounded-xl bg-[var(--chrome-surface)] border border-[var(--chrome-border)] px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-[var(--chrome-surface-hover)] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            Back to HomeField
          </a>
        </div>
        <UsersTable />
      </div>
    </div>
  );
}
