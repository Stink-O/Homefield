// The homefield://image/{id} resource.
//
// Registered as a template with `list: undefined` on purpose. A resources/list
// that enumerated the library would hand every client an unpaginated dump of
// the owner's images the moment it connected, before any tool call and without
// any workspace filter. The agent has to know an id — which it can only get
// from an ownership-checked tool — before it can read anything here.
//
// This is also the only place full-resolution pixels are served. Tools return a
// ~512px preview; the original arrives only when explicitly requested.

import type { McpServer } from "@modelcontextprotocol/server";
import { ResourceTemplate } from "@modelcontextprotocol/server";
import type { AgentPrincipal } from "@/lib/agent/contract";
import { AgentToolError, requireAccessibleImage } from "@/lib/mcp/context";
import { readFullImage } from "@/lib/mcp/preview";

export function registerImageResource(server: McpServer, principal: AgentPrincipal): void {
  server.registerResource(
    "homefield-image",
    new ResourceTemplate("homefield://image/{id}", { list: undefined }),
    {
      title: "HomeField image",
      description:
        "Full-resolution bytes of one image in the owner's library, addressed by id. Ids come from list_images, get_image or get_generation_status.",
      mimeType: "image/png",
    },
    async (uri, variables) => {
      const raw = variables.id;
      const id = Array.isArray(raw) ? raw[0] : raw;
      if (typeof id !== "string" || !id) {
        throw new Error("Malformed resource URI. Expected homefield://image/{id}.");
      }

      // Same guard the tools use: owner-scoped, workspace-scoped, no shared copies.
      let row;
      try {
        row = await requireAccessibleImage(principal, decodeURIComponent(id));
      } catch (err) {
        if (err instanceof AgentToolError) throw new Error(err.message);
        throw err;
      }

      const full = await readFullImage(row.filePath, row.mimeType);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: full.mimeType,
            blob: full.base64,
          },
        ],
      };
    },
  );
}
