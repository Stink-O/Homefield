import Link from "next/link";
import Image from "next/image";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { SetupForm } from "./SetupForm";

export default async function SetupPage() {
  const admin = await db.query.users.findFirst({ where: eq(users.role, "admin") });

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="w-full max-w-sm px-6">
        <div className="flex justify-center mb-8">
          <Image src="/logo-header.png" alt="HomeField" width={120} height={40} />
        </div>
        {admin ? (
          <div className="text-center">
            <p className="text-white font-semibold text-lg">Setup complete</p>
            <p className="text-white/40 text-sm mt-1 mb-6">An admin account already exists.</p>
            <Link
              href="/login"
              className="inline-block w-full rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-black font-semibold py-3 text-sm transition-colors"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-6 text-center">
              <h1 className="text-white font-semibold text-lg">First-time setup</h1>
              <p className="text-white/40 text-sm mt-1">Create the admin account to get started.</p>
            </div>
            <SetupForm />
          </>
        )}
      </div>
    </div>
  );
}
