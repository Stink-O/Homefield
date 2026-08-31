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
        path === "/setup" ||
        path === "/api/health" ||
        path.startsWith("/api/auth") ||
        path.startsWith("/api/files") ||
        path === "/api/register" ||
        path === "/api/setup" ||
        // The MCP endpoint authenticates itself with an agent API key
        // (Authorization: Bearer hf_live_…) and rejects session cookies
        // outright — see lib/agent/auth.ts. Without this exemption the
        // middleware answers every bearer request with a 302 to /login and
        // MCP clients report an opaque connection failure with no clue why.
        path === "/api/mcp"
      ) {
        return true;
      }

      // Redirect unauthenticated users to login
      return isLoggedIn;
    },
  },
  providers: [], // Providers defined in lib/auth.ts (Node.js runtime only)
};
