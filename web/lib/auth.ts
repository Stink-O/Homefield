import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { authConfig } from "@/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        try {
          if (!credentials?.username || !credentials?.password) return null;
          const user = await db.query.users.findFirst({
            where: eq(users.username, credentials.username as string),
          });
          if (!user) { console.error("[auth] user not found:", credentials.username); return null; }
          if (!user.approved) { console.error("[auth] user not approved:", credentials.username); return null; }
          const valid = await bcrypt.compare(credentials.password as string, user.passwordHash);
          if (!valid) { console.error("[auth] invalid password for:", credentials.username); return null; }
          return { id: user.id, name: user.username, role: user.role } as unknown as { id: string; name: string; role: string };
        } catch (err) {
          console.error("[auth] authorize threw:", err);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { id: string; name: string; role: string }).role;
      }
      // Handle session update triggered from the client (e.g. username change)
      if (trigger === "update" && session?.name) {
        token.name = session.name;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session.user as any).role = token.role as string;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
});
