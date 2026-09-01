// Skills shipped with the server, exposed over the skill:// URI scheme.
//
// Usage knowledge belongs with the server, not copied into every client that
// connects to it. Tool descriptions can say what an argument means; they are a
// bad place to explain that exploring at Flash/1K before re-rendering at Pro/4K
// is the difference between a sensible bill and a silly one.
//
// This follows SEP-2640 (the "skills" extension, io.modelcontextprotocol/skills),
// which deliberately builds on Resources rather than adding a primitive: a
// skill://index.json catalog for discovery, and skill://<name>/SKILL.md for the
// content. Progressive disclosure — a client reads the small catalog on
// connect, and fetches the instructions only when they are relevant.
//
// The proposal is still work in progress and no client auto-loads these yet, so
// the essentials are also condensed into the server's `instructions` field
// (see server.ts), which every client does read today. This path is what makes
// the full text available on demand, and ready when clients catch up.

import fs from "fs/promises";
import path from "path";
import type { McpServer } from "@modelcontextprotocol/server";
import { ResourceTemplate } from "@modelcontextprotocol/server";

const SKILLS_ROOT = path.join(process.cwd(), "data", "skills");

/** Skills bundled with this server. Names must match their directory. */
const BUNDLED_SKILLS = ["homefield-image-studio"] as const;

interface SkillMeta {
  name: string;
  description: string;
  uri: string;
}

// Read once per process. The files ship inside the image and never change at
// runtime, so re-reading them on every connect would be pure overhead.
declare global {

  var __hf_skill_cache: Map<string, string> | undefined;
}
if (!globalThis.__hf_skill_cache) {
  globalThis.__hf_skill_cache = new Map<string, string>();
}
const cache = globalThis.__hf_skill_cache;

async function readSkill(name: string): Promise<string | null> {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  // Names come from BUNDLED_SKILLS, never from a request, but resolve and check
  // anyway so this can never become a file-read primitive.
  const abs = path.join(SKILLS_ROOT, name, "SKILL.md");
  if (!abs.startsWith(SKILLS_ROOT + path.sep)) return null;
  try {
    const body = await fs.readFile(abs, "utf-8");
    cache.set(name, body);
    return body;
  } catch {
    return null;
  }
}

/** Pulls `name` and `description` out of the YAML frontmatter. */
function parseFrontmatter(source: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { name: out.name, description: out.description };
}

async function catalog(): Promise<SkillMeta[]> {
  const entries: SkillMeta[] = [];
  for (const dir of BUNDLED_SKILLS) {
    const body = await readSkill(dir);
    if (!body) continue;
    const { name, description } = parseFrontmatter(body);
    entries.push({
      name: name ?? dir,
      description: description ?? "",
      uri: `skill://${dir}/SKILL.md`,
    });
  }
  return entries;
}

export function registerSkillResources(server: McpServer): void {
  // Discovery catalog. Listed, unlike the image resource, because it is static
  // content shipped with the server rather than anyone's data — there is
  // nothing here to leak, and it has to be discoverable to be useful.
  server.registerResource(
    "skill-index",
    "skill://index.json",
    {
      title: "Skill index",
      description:
        "Catalog of skills bundled with this server: name, description and location. Read a skill's SKILL.md for the full instructions.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ skills: await catalog() }, null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    "skill-content",
    new ResourceTemplate("skill://{name}/SKILL.md", {
      list: async () => ({
        resources: (await catalog()).map((s) => ({
          uri: s.uri,
          name: s.name,
          description: s.description,
          mimeType: "text/markdown",
        })),
      }),
    }),
    {
      title: "Skill instructions",
      description: "How to use this server well — models, cost, the iteration loop, and the limits a key enforces.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const raw = variables.name;
      const name = Array.isArray(raw) ? raw[0] : raw;
      // Allowlisted, so a traversal attempt cannot reach outside the skill set.
      if (typeof name !== "string" || !(BUNDLED_SKILLS as readonly string[]).includes(name)) {
        throw new Error(`Unknown skill. Read skill://index.json for what this server ships.`);
      }
      const body = await readSkill(name);
      if (!body) throw new Error(`Skill "${name}" could not be read.`);
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: body }],
      };
    },
  );
}
