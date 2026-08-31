// Library tools: list_images, get_image, delete_image, move_image,
// publish_image, unpublish_image.
//
// Every one of them goes through requireAccessibleImage(), which is what binds
// a key to its owner's data and to its own workspace. None of them accept a
// user id, so there is no parameter an agent could set to reach another
// account's library.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import crypto from "crypto";
import { db } from "@/lib/db";
import { images, users } from "@/lib/db/schema";
import { deleteImageFile, deleteReferenceImages } from "@/lib/fileStorage";
import { broadcastImageDelete } from "@/lib/imageBroadcast";
import { broadcastShared } from "@/lib/sharedBroadcast";
import type { AgentPrincipal } from "@/lib/agent/contract";
import {
  ALL_WORKSPACES,
  AgentToolError,
  MAIN_WORKSPACE,
  describeDestination,
  imageResourceUri,
  imageSummary,
  requireAccessibleImage,
  requireScope,
  resolveWorkspaceFilter,
  resolveWorkspaceTarget,
  runTool,
  toolJson,
  toolText,
} from "@/lib/mcp/context";
import { imageIdSchema, workspaceIdSchema } from "@/lib/mcp/schemas";
import { renderPreview } from "@/lib/mcp/preview";

const MAX_PAGE = 50;

export function registerImageTools(server: McpServer, principal: AgentPrincipal): void {
  const scoped = principal.destinationMode === "any";

  server.registerTool(
    "list_images",
    {
      title: "List images",
      description:
        "Lists images in the owner's library, newest first, as metadata only — no pixels. Use get_image for a preview of a specific one. " +
        (scoped
          ? `Pass workspace_id to choose a workspace, "${MAIN_WORKSPACE}" for the Main library, or "${ALL_WORKSPACES}" to read across all of them.`
          : "This API key can only read the workspace it is restricted to; workspace_id is rejected if it names another."),
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({
        workspace_id: workspaceIdSchema.optional(),
        limit: z.number().int().min(1).max(MAX_PAGE).optional().describe(`How many to return. 1-${MAX_PAGE}, default 20.`),
        before: z
          .string()
          .optional()
          .describe("Pagination cursor: the `next_cursor` from a previous call. Returns images created strictly before it."),
      }),
    },
    async (args) =>
      runTool(async () => {
        const filter = await resolveWorkspaceFilter(principal, args.workspace_id);
        const limit = args.limit ?? 20;

        const conditions = [eq(images.userId, principal.userId), eq(images.isShared, false)];
        if (filter !== undefined) {
          conditions.push(filter === null ? isNull(images.workspaceId) : eq(images.workspaceId, filter));
        }
        if (args.before) {
          const cursor = Number(args.before);
          if (!Number.isFinite(cursor)) throw new AgentToolError("invalid_input", "`before` must be a cursor returned by a previous call.");
          conditions.push(lt(images.timestamp, cursor));
        }

        const rows = await db.select().from(images)
          .where(and(...conditions))
          .orderBy(desc(images.timestamp))
          .limit(limit + 1);

        const page = rows.slice(0, limit);
        return toolJson({
          images: page.map(imageSummary),
          has_more: rows.length > limit,
          next_cursor: rows.length > limit && page.length > 0 ? String(page[page.length - 1].timestamp) : null,
        });
      }),
  );

  server.registerTool(
    "get_image",
    {
      title: "Get an image",
      description:
        "Returns one image's metadata plus a small inline preview so you can see it. The full-resolution file is available as the linked homefield://image/{id} resource — read that only when you actually need the original pixels.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({ image_id: imageIdSchema }),
    },
    async (args) =>
      runTool(async () => {
        const row = await requireAccessibleImage(principal, args.image_id);
        const preview = await renderPreview(row.thumbnailPath ?? row.filePath);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(imageSummary(row), null, 2) },
            ...(preview ? [{ type: "image" as const, data: preview.base64, mimeType: preview.mimeType }] : []),
            {
              type: "resource_link" as const,
              uri: imageResourceUri(row.id),
              name: `image-${row.id}`,
              mimeType: row.mimeType,
              description: "Full-resolution image.",
            },
          ],
        };
      }),
  );

  // ── Scoped: delete ─────────────────────────────────────────────────────────

  server.registerTool(
    "delete_image",
    {
      title: "Delete an image",
      description:
        "Permanently deletes an image and its file from the owner's library. Requires the \"delete\" scope. Published copies are not deleted by this tool — use unpublish_image for those.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({ image_id: imageIdSchema }),
    },
    async (args) =>
      runTool(async () => {
        requireScope(principal, "delete");
        const row = await requireAccessibleImage(principal, args.image_id);

        await deleteImageFile(row.filePath, row.thumbnailPath ?? null);
        if (row.referenceImagePaths) {
          const ownerId = row.filePath.split("/")[2]; // storage/images/<ownerId>/...
          await deleteReferenceImages(ownerId, row.id);
        }
        await db.delete(images).where(eq(images.id, row.id));
        broadcastImageDelete(principal.userId, row.id);

        return toolText(`Deleted image ${row.id}.`);
      }),
  );

  // ── Scoped: publish / unpublish ────────────────────────────────────────────

  server.registerTool(
    "publish_image",
    {
      title: "Publish to the shared space",
      description:
        "Publishes an image to the instance-wide shared space, visible to every account on this HomeField. This creates a NEW shared entry and returns its id; the original stays where it is and is unchanged. Pass the returned shared_image_id to unpublish_image to take it down. Requires the \"publish\" scope.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({ image_id: imageIdSchema }),
    },
    async (args) =>
      runTool(async () => {
        requireScope(principal, "publish");
        const source = await requireAccessibleImage(principal, args.image_id);

        // A shared entry is a second row pointing at the same file on disk, not
        // a flag on the original — see app/api/images/[id]/share/route.ts.
        const sharedId = crypto.randomUUID();
        const timestamp = Date.now();
        await db.insert(images).values({
          ...source,
          id: sharedId,
          workspaceId: null,
          isShared: true,
          timestamp,
          // Provenance points at the key that published it, so a restricted key
          // can later identify (and only unpublish) its own shares.
          origin: "agent",
          agentKeyId: principal.keyId,
          agentLabel: principal.label,
        });

        const owner = await db.query.users.findFirst({ where: eq(users.id, principal.userId) });
        broadcastShared({
          id: sharedId,
          jobId: sharedId,
          userId: principal.userId,
          username: owner?.username ?? "",
          prompt: source.prompt,
          model: source.model,
          aspectRatio: source.aspectRatio,
          quality: source.quality ?? null,
          width: source.width,
          height: source.height,
          thumbnailUrl: source.thumbnailPath ? `/api/files/${source.thumbnailPath}` : "",
          timestamp,
        });

        return toolJson({ shared_image_id: sharedId, source_image_id: source.id });
      }),
  );

  server.registerTool(
    "unpublish_image",
    {
      title: "Remove from the shared space",
      description:
        "Takes a published entry down from the shared space. Pass the shared_image_id that publish_image returned, not the original image id. The original image is untouched. Requires the \"publish\" scope.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        shared_image_id: z.string().min(1).describe("The id returned by publish_image."),
      }),
    },
    async (args) =>
      runTool(async () => {
        requireScope(principal, "publish");

        const row = await db.query.images.findFirst({
          where: and(
            eq(images.id, args.shared_image_id),
            eq(images.userId, principal.userId),
            eq(images.isShared, true),
          ),
        });
        if (!row) {
          throw new AgentToolError(
            "not_found",
            `No shared entry ${args.shared_image_id} belongs to this account. Pass the shared_image_id returned by publish_image.`,
          );
        }
        // A workspace-restricted key may only retract what it published itself.
        if (principal.destinationMode !== "any" && row.agentKeyId !== principal.keyId) {
          throw new AgentToolError(
            "workspace_forbidden",
            "This API key can only unpublish entries it published itself.",
          );
        }

        // Row only. The file on disk is shared with the source image — deleting
        // it here would take the original's pixels with it.
        await db.delete(images).where(eq(images.id, row.id));
        return toolText(`Removed shared entry ${row.id} from the shared space.`);
      }),
  );

  // ── Mode-gated: move ───────────────────────────────────────────────────────
  // Only offered when the key may address more than one workspace. For "own"
  // and "pinned" keys there is nowhere legal to move an image to, so the tool
  // is not registered at all rather than registered and always refused.
  if (scoped) {
    server.registerTool(
      "move_image",
      {
        title: "Move an image",
        description:
          `Moves an image into another of the owner's workspaces. Pass "${MAIN_WORKSPACE}" to move it to the Main library. ` +
          describeDestination(principal),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        inputSchema: z.object({
          image_id: imageIdSchema,
          workspace_id: workspaceIdSchema,
        }),
      },
      async (args) =>
        runTool(async () => {
          const row = await requireAccessibleImage(principal, args.image_id);
          const target = await resolveWorkspaceTarget(principal, args.workspace_id);
          await db.update(images)
            .set({ workspaceId: target })
            .where(and(eq(images.id, row.id), eq(images.userId, principal.userId)));
          return toolText(`Moved image ${row.id} to ${target ?? "the Main library"}.`);
        }),
    );
  }
}
