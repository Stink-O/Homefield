import { redirect } from "next/navigation";
import { LoginForm } from "./LoginForm";
import Image from "next/image";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export default async function LoginPage() {
  const admin = await db.query.users.findFirst({ where: eq(users.role, "admin") });
  if (!admin) {
    redirect("/setup");
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="w-full max-w-sm px-6">
        <div className="flex justify-center mb-8">
          <Image src="/logo-header.png" alt="HomeField" width={120} height={40} />
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
