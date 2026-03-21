import type { NextAuthConfig } from "next-auth";

// Lightweight auth config for Edge Runtime (middleware).
// No database imports, no credentials provider — just token validation.
export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const path = nextUrl.pathname;

      // Always allow auth endpoints and login page
      if (
        path === "/login" ||
        path.startsWith("/api/auth") ||
        path.startsWith("/api/files") ||
        path === "/api/register"
      ) {
        return true;
      }

      // Redirect unauthenticated users to login
      return isLoggedIn;
    },
  },
  providers: [], // Providers defined in lib/auth.ts (Node.js runtime only)
};
