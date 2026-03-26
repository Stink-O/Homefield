import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  createMusicJob,
  resolveMusicJob,
  failMusicJob,
  registerMusicJobAbort,
  unregisterMusicJobAbort,
} from "@/lib/musicJobs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { tracks } from "@/lib/db/schema";
import { saveAudioFile } from "@/lib/fileStorage";
import { checkRateLimit } from "@/lib/rateLimit";

const MAX_PROMPT_LENGTH = 2000;
const LYRIA_TIMEOUT_MS = 240_000;
const VALID_MODELS = ["lyria-3-pro-preview", "lyria-3-clip-preview"] as const;
type LyriaModel = (typeof VALID_MODELS)[number];

export const dynamic = "force-dynamic";

interface ServiceAccount {
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

function parseServiceAccount(raw: string): ServiceAccount {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON: not valid JSON");
  }
  for (const field of ["private_key", "client_email", "token_uri", "project_id"] as const) {
    if (typeof parsed[field] !== "string" || !(parsed[field] as string)) {
      throw new Error(`Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON: missing field ${field}`);
    }
  }
  return parsed as unknown as ServiceAccount;
}

const _credJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const MODULE_SA: ServiceAccount | null = _credJson ? parseServiceAccount(_credJson) : null;

function createJWT(sa: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      sub: sa.client_email,
      aud: sa.token_uri,
      iat: now,
      exp: now + 3600,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    })
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  return `${signingInput}.${sign.sign(sa.private_key, "base64url")}`;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 5 * 60 * 1000) return cachedToken.value;
  const jwt = createJWT(sa);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(sa.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description || "Failed to get access token");
  }
  const data = await res.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

interface LyriaOutput {
  type?: string;
  data?: string;
  mime_type?: string;
  text?: string;
}

async function callLyria(
  sa: ServiceAccount,
  prompt: string,
  options: {
    model?: string;
    imageData?: string;
    imageMimeType?: string;
    cancelSignal?: AbortSignal;
  } = {}
): Promise<{ base64: string; mimeType: string; lyrics?: string; description?: string }> {
  const { model = "lyria-3-pro-preview", imageData, imageMimeType, cancelSignal } = options;

  const accessToken = await getAccessToken(sa);
  const url = `https://aiplatform.googleapis.com/v1beta1/projects/${sa.project_id}/locations/global/interactions`;

  const input: Array<Record<string, string>> = [{ type: "text", text: prompt }];
  if (imageData && imageMimeType) {
    input.push({ type: "image", mime_type: imageMimeType, data: imageData });
  }

  const body = { model, input };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LYRIA_TIMEOUT_MS);
  const onCancel = () => controller.abort();
  cancelSignal?.addEventListener("abort", onCancel, { once: true });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    cancelSignal?.removeEventListener("abort", onCancel);
    if (err instanceof Error && err.name === "AbortError") {
      if (cancelSignal?.aborted) throw new Error("Cancelled");
      throw new Error(`Lyria request timed out after ${LYRIA_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
  clearTimeout(timer);
  cancelSignal?.removeEventListener("abort", onCancel);

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Lyria returned a non-JSON response (status ${res.status})`);
  }

  if (!res.ok) {
    const err = data?.error as { message?: string } | undefined;
    console.error(`[HomeField] Lyria ${res.status}:`, JSON.stringify(err ?? data));
    const msg =
      res.status === 429
        ? "Rate limit reached — please wait a moment and retry"
        : err?.message || `Lyria error (${res.status})`;
    throw new Error(msg);
  }

  const outputs = data.outputs as LyriaOutput[] | undefined;

  // Separate audio and text outputs
  const audioOutput =
    (outputs ?? []).find((o) => (o.mime_type || "").startsWith("audio/")) ??
    (outputs ?? []).find((o) => o.type === "audio") ??
    (outputs ?? []).find((o) => !!o.data);

  const textOutputs = (outputs ?? [])
    .filter((o) => o.type === "text" || (o.type === "lyrics") || (o.type === "description"))
    .filter((o) => typeof o.text === "string" && o.text)
    .map((o) => ({ type: o.type, text: o.text as string }));

  // Named outputs take priority; fall back to positional (first=description, second=lyrics)
  const descriptionText =
    textOutputs.find((o) => o.type === "description")?.text ?? textOutputs[0]?.text;
  const lyricsText =
    textOutputs.find((o) => o.type === "lyrics")?.text ?? textOutputs[1]?.text;

  // predict-style fallback: { predictions: [{ audioContent, mimeType }] }
  if (!audioOutput?.data) {
    const predictions = data.predictions as Array<{ audioContent?: string; mimeType?: string }> | undefined;
    const p = predictions?.[0];
    if (p?.audioContent) {
      return { base64: p.audioContent, mimeType: p.mimeType || "audio/mpeg" };
    }
    console.error("[HomeField] callLyria — no audio found. Keys:", Object.keys(data));
    throw new Error("No audio in Lyria response");
  }

  return {
    base64: audioOutput.data,
    mimeType: audioOutput.mime_type || "audio/mpeg",
    ...(descriptionText && { description: descriptionText }),
    ...(lyricsText && { lyrics: lyricsText }),
  };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userRole = (session.user as { id: string; role?: string }).role;
  const rl =
    userRole === "admin"
      ? { allowed: true, retryAfterMs: 0 }
      : checkRateLimit(`music:${userId}`, 10, 10 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached — please wait before generating more music." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { prompt, model, imageData, imageMimeType } = body as {
    prompt: unknown;
    model: unknown;
    imageData: unknown;
    imageMimeType: unknown;
  };

  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "Prompt required" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `Prompt must be at most ${MAX_PROMPT_LENGTH} characters` },
      { status: 400 }
    );
  }

  const selectedModel: LyriaModel =
    typeof model === "string" && VALID_MODELS.includes(model as LyriaModel)
      ? (model as LyriaModel)
      : "lyria-3-pro-preview";

  // Validate optional image
  let validatedImage: { data: string; mimeType: string } | null = null;
  if (imageData != null) {
    if (typeof imageData !== "string" || typeof imageMimeType !== "string") {
      return NextResponse.json({ error: "Invalid image data" }, { status: 400 });
    }
    if (!["image/jpeg", "image/png"].includes(imageMimeType)) {
      return NextResponse.json({ error: "Image must be JPEG or PNG" }, { status: 400 });
    }
    if (imageData.length > 10_000_000) {
      return NextResponse.json({ error: "Image too large (max ~7MB)" }, { status: 400 });
    }
    validatedImage = { data: imageData, mimeType: imageMimeType };
  }

  const sa = MODULE_SA;
  if (!sa) return NextResponse.json({ error: "Server credentials not configured" }, { status: 500 });

  const jobId = crypto.randomUUID();
  const trackId = crypto.randomUUID();
  createMusicJob(jobId);

  const genController = new AbortController();
  registerMusicJobAbort(jobId, () => genController.abort());

  (async () => {
    try {
      console.log(
        `[HomeField] music ${jobId.slice(0, 8)} → ${selectedModel} | "${prompt.slice(0, 80)}${prompt.length > 80 ? "..." : ""}"`
      );

      const result = await callLyria(sa, prompt.trim(), {
        model: selectedModel,
        imageData: validatedImage?.data,
        imageMimeType: validatedImage?.mimeType,
        cancelSignal: genController.signal,
      });

      const filePath = await saveAudioFile(userId, trackId, result.base64, result.mimeType);
      const timestamp = Date.now();

      await db.insert(tracks).values({
        id: trackId,
        userId,
        prompt: prompt.trim(),
        model: selectedModel,
        filePath,
        mimeType: result.mimeType,
        timestamp,
        lyrics: result.lyrics ?? null,
        description: result.description ?? null,
      });

      resolveMusicJob(jobId, {
        id: trackId,
        prompt: prompt.trim(),
        model: selectedModel,
        filePath,
        mimeType: result.mimeType,
        timestamp,
        lyrics: result.lyrics ?? null,
        description: result.description ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      console.error(`[HomeField] music ${jobId.slice(0, 8)} FAILED:`, message);
      failMusicJob(jobId, message);
    } finally {
      unregisterMusicJobAbort(jobId);
    }
  })();

  return NextResponse.json({ jobId });
}
