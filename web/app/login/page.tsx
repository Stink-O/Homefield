export const dynamic = "force-dynamic";

import Link from "next/link";
import { LoginForm } from "./LoginForm";
import Image from "next/image";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export default async function LoginPage() {
  const admin = await db.query.users.findFirst({ where: eq(users.role, "admin") });
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="w-full max-w-sm px-6">
        <div className="flex justify-center mb-8">
          <Image src="/logo-header.png" alt="HomeField" width={120} height={40} />
        </div>
        {admin ? (
          <LoginForm />
        ) : (
          <div className="text-center">
            <p className="text-white font-semibold text-lg">Setup required</p>
            <p className="text-white/40 text-sm mt-1 mb-6">Create an admin account before signing in.</p>
            <Link
              href="/setup"
              className="inline-block w-full rounded-xl bg-[#a3e635] hover:bg-[#bef264] text-black font-semibold py-3 text-sm transition-colors"
            >
              Go to setup
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
