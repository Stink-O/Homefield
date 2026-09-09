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
import { MAX_REFERENCE_IMAGES, UPLOAD_MIME_TYPES, workspaceIdSchema } from "@/lib/mcp/schemas";

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
        "Pass count to mint several at once — one per image, in order — when the user supplied more than one file; " +
        "batching the curls into a single shell call beats a round-trip per image. " +
        "Uploads do not count against the daily generation budget. Requires the \"upload\" scope. " +
        describeDestination(principal),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        workspace_id: workspaceIdSchema.optional(),
        // Coerced, not plain z.number(). MCP clients cache the tool list for
        // the life of a session, so a client connected before this argument
        // existed does not know its type and sends it as a bare string — the
        // call then fails validation for a value the caller got right. Every
        // such client is one restart from being correct, which is exactly the
        // kind of breakage that is invisible to whoever added the argument.
        // Coercion accepts 3 and "3" alike; the int/min/max checks below still
        // reject anything that is not a whole number in range.
        count: z.coerce
          .number()
          .int()
          .min(1)
          .max(MAX_REFERENCE_IMAGES)
          .optional()
          .describe(`How many upload URLs to mint, one per image. 1-${MAX_REFERENCE_IMAGES}, default 1.`),
      }),
    },
    async (args) =>
      runTool(async () => {
        requireScope(principal, "upload");

        // Same guard as generate_image: a restricted key gets its own
        // workspace and any other value is refused, not redirected.
        const workspaceId = await resolveWorkspaceTarget(principal, args.workspace_id);

        // One grant per image. Each URL is independently signed, single-use and
        // bound to its own image id, so a batch is just N of the same thing.
        // The rate limiter counts URLs rather than calls, so mint one at a time
        // and stop when it says stop — reserving the whole batch up front would
        // let a single large request deny itself outright.
        const count = args.count ?? 1;
        const now = Date.now();
        const rateKey = `agent-upload-url:${principal.keyId}`;
        const grants: { image_id: string; upload_url: string }[] = [];
        let retryAfterSeconds: number | null = null;

        for (let i = 0; i < count; i++) {
          const rl = checkRateLimit(rateKey, UPLOAD_RATE_LIMIT, UPLOAD_RATE_WINDOW_MS);
          if (!rl.allowed) {
            // Nothing minted at all is a failure; a partial batch is still
            // useful, so hand back what we have and say what was withheld.
            if (grants.length === 0) {
              throw new AgentToolError(
                "daily_limit_reached",
                `Rate limit reached (${UPLOAD_RATE_LIMIT} upload URLs per ${UPLOAD_RATE_WINDOW_MS / 60000} minutes). Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
              );
            }
            retryAfterSeconds = Math.ceil(rl.retryAfterMs / 1000);
            break;
          }

          const imageId = crypto.randomUUID();
          grants.push({
            image_id: imageId,
            upload_url: uploadUrlFor(origin, imageId, principal.keyId, workspaceId, now),
          });
        }

        const curlFor = (url: string) => `curl -fsS -F "${UPLOAD_FILE_FIELD}=@/path/to/image.png" "${url}"`;
        const shared = {
          workspace_id: workspaceId ?? MAIN_WORKSPACE,
          expires_at: new Date(now + UPLOAD_TTL_MS).toISOString(),
          max_bytes: MAX_UPLOAD_BYTES,
          accepted_types: UPLOAD_MIME_TYPES,
        };

        // A single grant keeps the original flat shape, so the one-image case
        // and every existing caller are byte-for-byte unchanged.
        if (count === 1) {
          const [only] = grants;
          return toolJson(
            { ...only, ...shared, curl: curlFor(only.upload_url) },
            `Run the curl command with your file's path (no auth header). On success it prints the image's metadata; then pass image_id to generate_image via reference_image_ids. The URL is single-use and expires in about ${TTL_MINUTES} minutes; call this tool again for a fresh one.`,
          );
        }

        return toolJson(
          {
            uploads: grants.map((g) => ({ ...g, curl: curlFor(g.upload_url) })),
            ...shared,
            ...(retryAfterSeconds === null
              ? {}
              : { minted: grants.length, requested: count, retry_after_seconds: retryAfterSeconds }),
          },
          `${grants.length} upload URL(s), one per image, in the order requested. Run each curl with its own file, batched into a single shell call rather than a round-trip each, then pass every image_id to generate_image in reference_image_ids. Each URL is single-use and expires in about ${TTL_MINUTES} minutes.` +
            (retryAfterSeconds === null
              ? ""
              : ` Only ${grants.length} of ${count} could be minted before the rate limit; retry in ${retryAfterSeconds}s for the rest.`),
        );
      }),
  );
}
