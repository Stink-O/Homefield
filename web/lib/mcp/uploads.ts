// create_upload_url: how a file on the agent's disk gets into the library.
//
// generate_image can take references two ways. reference_image_ids is a 36-char
// id per image and is what every edit loop should use. reference_images is
// inline base64, which means the model has to emit the whole file verbatim
// inside a tool call — and in practice a call carrying even a 10 KB image fails
// partway through, every time. The bottleneck is the model's own output, not
// the server, so no server-side cap helps.
//
// This tool closes the gap by inverting the download flow: it mints a signed,
// short-lived, single-use URL that the agent curls a local file to, and the
// file arrives as a library image with an id that reference_image_ids accepts.
// The bytes go from disk to server and never through the context window.
//
// The image id and the destination workspace are fixed here, inside the same
// guards every other write goes through, and are covered by the signature. The
// route that receives the bytes (app/api/agent/uploads/[id]/route.ts) verifies
// the grant and re-checks the key and account; it never takes a workspace from
// the request body.

import crypto from "crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { AgentPrincipal } from "@/lib/agent/contract";
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_FILE_FIELD,
  UPLOAD_RATE_LIMIT,
  UPLOAD_RATE_WINDOW_MS,
  UPLOAD_TTL_MS,
  uploadUrlFor,
} from "@/lib/agent/downloadToken";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  AgentToolError,
  MAIN_WORKSPACE,
  describeDestination,
  requireScope,
  resolveWorkspaceTarget,
  runTool,
  toolJson,
} from "@/lib/mcp/context";
import { UPLOAD_MIME_TYPES, workspaceIdSchema } from "@/lib/mcp/schemas";

const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
const TTL_MINUTES = Math.round(UPLOAD_TTL_MS / 60_000);

export function registerUploadTools(server: McpServer, principal: AgentPrincipal, origin: string): void {
  server.registerTool(
    "create_upload_url",
    {
      title: "Create an upload URL",
      description:
        "Mints a short-lived, single-use URL for putting an image file from disk into the owner's library, so it can be edited by passing its id to generate_image in reference_image_ids. " +
        "This is the way to use a file you have on disk — a screenshot, a crop, anything you did not generate here. reference_images (inline base64) is only for bytes you already hold in context; inlining a file, even a small one, tends to fail. " +
        `The URL needs no auth header: upload with the curl command in the result. Accepts JPEG, PNG and WebP up to ${MAX_UPLOAD_MB} MB, expires in about ${TTL_MINUTES} minutes and can be used once. ` +
        "Uploads do not count against the daily generation budget. Requires the \"upload\" scope. " +
        describeDestination(principal),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        workspace_id: workspaceIdSchema.optional(),
      }),
    },
    async (args) =>
      runTool(async () => {
        requireScope(principal, "upload");

        const rl = checkRateLimit(`agent-upload-url:${principal.keyId}`, UPLOAD_RATE_LIMIT, UPLOAD_RATE_WINDOW_MS);
        if (!rl.allowed) {
          throw new AgentToolError(
            "daily_limit_reached",
            `Rate limit reached (${UPLOAD_RATE_LIMIT} upload URLs per ${UPLOAD_RATE_WINDOW_MS / 60000} minutes). Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
          );
        }

        // Same guard as generate_image: a restricted key gets its own
        // workspace and any other value is refused, not redirected.
        const workspaceId = await resolveWorkspaceTarget(principal, args.workspace_id);

        const now = Date.now();
        const imageId = crypto.randomUUID();
        const uploadUrl = uploadUrlFor(origin, imageId, principal.keyId, workspaceId, now);

        return toolJson(
          {
            image_id: imageId,
            upload_url: uploadUrl,
            workspace_id: workspaceId ?? MAIN_WORKSPACE,
            expires_at: new Date(now + UPLOAD_TTL_MS).toISOString(),
            max_bytes: MAX_UPLOAD_BYTES,
            accepted_types: UPLOAD_MIME_TYPES,
            curl: `curl -fsS -F "${UPLOAD_FILE_FIELD}=@/path/to/image.png" "${uploadUrl}"`,
          },
          `Run the curl command with your file's path (no auth header). On success it prints the image's metadata; then pass image_id to generate_image via reference_image_ids. The URL is single-use and expires in about ${TTL_MINUTES} minutes; call this tool again for a fresh one.`,
        );
      }),
  );
}
