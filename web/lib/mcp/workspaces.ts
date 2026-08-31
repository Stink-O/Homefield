// list_workspaces and the mode-gated create_workspace.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import type { AgentPrincipal } from "@/lib/agent/contract";
import { MAIN_WORKSPACE, describeDestination, runTool, toolJson } from "@/lib/mcp/context";

const MAX_WORKSPACE_NAME = 60;

export function registerWorkspaceTools(server: McpServer, principal: AgentPrincipal): void {
  const scoped = principal.destinationMode === "any";

  server.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description:
        "Lists the workspaces this API key may address, and marks the one it writes to by default. " +
        describeDestination(principal),
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({}),
    },
    async () =>
      runTool(async () => {
        // A restricted key is told about its own destination and nothing else —
        // the shape of the owner's library is not its business.
        if (!scoped) {
          return toolJson({
            destination_mode: principal.destinationMode,
            workspaces: [
              {
                id: principal.defaultWorkspaceId ?? MAIN_WORKSPACE,
                name: principal.defaultWorkspaceId ? await nameOf(principal.defaultWorkspaceId) : "Main",
                is_default: true,
              },
            ],
          });
        }

        const owned = await db.select().from(workspaces)
          .where(eq(workspaces.userId, principal.userId))
          .orderBy(workspaces.createdAt);

        return toolJson({
          destination_mode: principal.destinationMode,
          workspaces: [
            { id: MAIN_WORKSPACE, name: "Main", is_default: principal.defaultWorkspaceId === null },
            ...owned.map((w) => ({
              id: w.id,
              name: w.name,
              is_default: w.id === principal.defaultWorkspaceId,
            })),
          ],
        });
      }),
  );

  // Mode-gated: a key confined to one workspace has no use for a second one,
  // and letting it mint workspaces would let it grow its own blast radius.
  if (scoped) {
    server.registerTool(
      "create_workspace",
      {
        title: "Create a workspace",
        description: "Creates a new workspace in the owner's account and returns its id, ready to pass to generate_image or move_image.",
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        inputSchema: z.object({
          name: z.string().trim().min(1).max(MAX_WORKSPACE_NAME).describe(`Workspace name, up to ${MAX_WORKSPACE_NAME} characters.`),
        }),
      },
      async (args) =>
        runTool(async () => {
          const workspace = {
            id: crypto.randomUUID(),
            userId: principal.userId,
            name: args.name,
            createdAt: Date.now(),
          };
          await db.insert(workspaces).values(workspace);
          return toolJson({ id: workspace.id, name: workspace.name });
        }),
    );
  }
}

async function nameOf(workspaceId: string): Promise<string> {
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  return ws?.name ?? "Unknown";
}
