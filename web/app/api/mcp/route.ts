// The MCP endpoint.
//
// Protocol revision 2026-07-28 is stateless: no session ids, no Redis, no
// server-side conversation state. Every request carries its own credential and
// is authenticated from scratch.
//
// Authentication is bearer-only. requireAgentKey() refuses any request carrying
// a NextAuth session cookie outright, rather than falling back to it: HomeField
// issues no CSRF tokens anywhere, so a cookie fallback would mean any page open
// in the owner's browser could POST here cross-origin and drive the whole tool
// set with the owner's ambient authority. A bearer header cannot be forged that
// way. auth.config.ts exempts this path from the login redirect so those bearer
// requests reach us at all.

import { createMcpHandler } from "mcp-handler";
import { agentDenialResponse, requireAgentKey } from "@/lib/agent/auth";
import { isDenial } from "@/lib/agent/contract";
import { MCP_SERVER_INFO, buildInstructions, registerAgentServer } from "@/lib/mcp/server";

// better-sqlite3 and sharp are native modules — this route cannot run on Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const principal = await requireAgentKey(request);
  if (isDenial(principal)) return agentDenialResponse(principal);

  // Built per request so the tool set can depend on the key: a key that may
  // only write to one workspace is never offered move_image or
  // create_workspace. See lib/mcp/server.ts.
  const handler = createMcpHandler(
    (server) => registerAgentServer(server, principal),
    {
      serverInfo: MCP_SERVER_INFO,
      instructions: buildInstructions(principal),
      verboseLogs: process.env.NODE_ENV !== "production",
    },
  );

  return handler(request);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
