import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { images } from "@/lib/db/schema";
import { requireAuth } from "@/lib/authHelpers";
import { saveImageFile } from "@/lib/fileStorage";
import crypto from "crypto";

export const maxDuration = 120;

const KNOWN_RATIOS = [
  { label: "1:1",  w: 1,  h: 1  },
  { label: "2:3",  w: 2,  h: 3  },
  { label: "3:2",  w: 3,  h: 2  },
  { label: "3:4",  w: 3,  h: 4  },
  { label: "4:3",  w: 4,  h: 3  },
  { label: "4:5",  w: 4,  h: 5  },
  { label: "5:4",  w: 5,  h: 4  },
  { label: "9:16", w: 9,  h: 16 },
  { label: "16:9", w: 16, h: 9  },
  { label: "21:9", w: 21, h: 9  },
];

function closestAspectRatio(width: number, height: number): string {
  const ratio = width / height;
  let best = "1:1";
  let minDiff = Infinity;
  for (const r of KNOWN_RATIOS) {
    const diff = Math.abs(ratio - r.w / r.h);
    if (diff < minDiff) { minDiff = diff; best = r.label; }
  }
  return best;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Could not parse request" }, { status: 400 });
  }

  const rawWorkspaceId = formData.get("workspaceId") as string | null;
  const effectiveWorkspaceId = (!rawWorkspaceId || rawWorkspaceId === "main") ? null : rawWorkspaceId;
  const files = formData.getAll("images") as File[];

  if (!files.length) {
    return NextResponse.json({ error: "No images provided" }, { status: 400 });
  }

  let imported = 0;
  let failed = 0;
  const now = Date.now();

  const BATCH = 5;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        const mimeType = file.type || "image/jpeg";
        if (!mimeType.startsWith("image/")) throw new Error("Not an image");

        const buffer = Buffer.from(await file.arrayBuffer());
        const base64 = buffer.toString("base64");
        const newId = crypto.randomUUID();

        const { filePath, thumbnailPath, width, height } = await saveImageFile(
          auth.userId,
          newId,
          base64,
          mimeType,
        );

        const name = file.name.replace(/\.[^.]+$/, "") || "Imported image";

        await db.insert(images).values({
          id: newId,
          userId: auth.userId,
          workspaceId: effectiveWorkspaceId,
          prompt: name,
          model: "imported",
          aspectRatio: closestAspectRatio(width, height),
          selectedAspectRatio: null,
          quality: null,
          width,
          height,
          filePath,
          thumbnailPath,
          mimeType,
          timestamp: now,
          searchGrounding: null,
          isShared: false,
          referenceImagePaths: null,
        });
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") imported++;
      else failed++;
    }
  }

  return NextResponse.json({ success: true, imported, failed });
}
