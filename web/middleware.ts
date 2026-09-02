import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  matcher: [
    // The bearer-authenticated agent routes (/api/mcp and /api/agent/*) are
    // excluded here outright, not merely allowlisted in auth.config.ts. Running
    // the proxy in front of them buys nothing — they refuse session cookies —
    // and costs two things: the proxy layer buffers a request body (up to
    // experimental.proxyClientMaxBodySize, 1 GB here) before the route handler
    // runs, which would defeat the MCP route's Content-Length ceiling, and it
    // tries to decode any session cookie it sees, logging a JWTSessionError
    // for the very cookies those routes are about to reject.
    "/((?!_next/static|_next/image|favicon\\.ico|logo\\.png|logo-header\\.png|api/mcp(?:/|$)|api/agent/).*)",
  ],
};
