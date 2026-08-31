<div align="center">

<img src="web/public/logo.png" alt="HomeField Studio" width="96" />

# HomeField Studio

[![GitHub Stars](https://img.shields.io/github/stars/Stink-O/Homefield?style=flat-square)](https://github.com/Stink-O/Homefield/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/Stink-O/Homefield?style=flat-square)](https://github.com/Stink-O/Homefield/commits/master)
[![Docker](https://img.shields.io/badge/docker-ghcr.io-blue?style=flat-square&logo=docker)](https://github.com/Stink-O/Homefield/pkgs/container/homefield)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

⭐ If you like this project, star it on GitHub. It helps a lot!

[Features](#features) • [Prerequisites](#prerequisites) • [Quick Start](#quick-start) • [Self-Hosting](#self-hosting-with-docker) • [Agent Access](#agent-access-mcp) • [Local Development](#local-development) • [Roadmap](#roadmap)

</div>

---
Free, frontier-level image generation. Built to run on the Google Cloud console using its $300 free trial credit.

A self-hosted AI studio for image and music generation, built on Google's Gemini Enterprise platform (formerly Vertex AI). No subscription, no middleman markup, no consumer-app data mining. Your entire library lives in SQLite and flat files on your own disk, and the only third party involved is Google's API, billed at raw rates with your own key. Clone the repo, run the setup script, and you have a private creative studio running on your own hardware.

If you've used [Higgsfield](https://higgsfield.ai), it's the same gallery-first experience, except you own the server, the library, and the costs: no subscription, just your own Google API key.

https://github.com/user-attachments/assets/69a89fee-0e56-4357-b8da-cdcc0def27c2

![HomeField desktop gallery view](Github_Homefield_Desktop_view_image.png)

<details>
<summary>Mobile screenshots</summary>
<br>
<table>
  <tr>
    <td><img src="Github_Homefield_Mobile_view_image.png" alt="HomeField mobile gallery view" width="360"/></td>
    <td><img src="Github_Homefield_Mobile_prompt_window_view_image.png" alt="HomeField mobile prompt sheet" width="360"/></td>
  </tr>
</table>
</details>

---

## Features

### Image generation

- **Models:** Nano Banana 2 (fast) and Nano Banana Pro (flagship)
- **Reference images:** attach up to 14 per prompt to guide style or composition
- **Aspect ratios:** Auto, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
- **Resolution:** 512, 1K, 2K, or 4K output
- **Batch generation:** run multiple generations from the same prompt at once
- **Search grounding:** optionally anchor generations in live web context

### Music generation _(work in progress)_

- **Text-to-music** via Google Lyria
- **Duration:** 30s, 60s, 3 min, 4 min
- **Controls:** BPM, intensity, instrumental toggle, custom lyrics, watermark
- **Models:** Lyria 3 Pro Preview and Lyria 3 Clip Preview

### Organisation

- **Project workspaces** to separate generations by project or client
- **Prompt template library** with categories, favourites, and "For You" recommendations based on your history (powered by Google's text-embedding-004 model)
- **Cross-device sync** so everything follows your account across devices and tabs

### Agent access

- **MCP server** at `/api/mcp` so AI agents can generate into your library
- **Per-agent workspaces** so agent output never lands in your own
- **Scoped API keys** with spend ceilings, an expiry, and one-click revocation
- **Visible provenance:** every agent-made image is badged and fully inspectable

### Collaboration

- **Live pending states:** generations started anywhere show up on every open session in real time
- **Shared gallery** for broadcasting to a public live feed
- **Multi-user support** with admin-controlled account approval
- **Admin panel** for managing users, roles, and backups

---

## Prerequisites

> [!IMPORTANT]
> HomeField runs entirely on Google Cloud infrastructure. You need a Google Cloud Console account to use it. If you have a Google account, you already have access at [cloud.google.com](https://cloud.google.com). New accounts get $300 in free credits valid for 90 days, which covers months of regular use.

- **A Google Cloud project** with the [Gemini Enterprise API](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com) (`aiplatform.googleapis.com`) enabled
- **A service account JSON key** with the **Vertex AI User** role (`roles/aiplatform.user`; the console may show it under the newer Gemini Enterprise branding)
- **Docker and Docker Compose** ([install Docker](https://docs.docker.com/get-docker/))

> [!NOTE]
> Google renamed Vertex AI to **Gemini Enterprise** in April 2026. The console shows the new branding, but the underlying APIs, roles, and this app's configuration are unchanged.

> [!NOTE]
> No GPU required. All generation runs on Google's infrastructure.

### What it costs

HomeField itself is free (MIT). Generation runs on your own Google Cloud account:

- **New GCP accounts get $300 in free credits** (valid 90 days), which covers months of regular use
- After that, you pay Google's standard [Gemini Enterprise per-image rates](https://cloud.google.com/vertex-ai/generative-ai/pricing) directly. No markup, no subscription, no minimum
- Your prompts and images go to Google's API for generation and nowhere else; the library, accounts, and metadata stay on your server

---

## Quick Start

Paste this into any AI coding agent (Claude Code / Cowork, Codex, Hermes, or Openclaw) and it will walk you through the entire setup:

```
I want to self-host HomeField Studio, an AI image and music generation web app that runs on Google's Gemini Enterprise platform (formerly Vertex AI). Help me get it running from scratch.

Work through these steps in order, confirm each one is done before moving on, and ask me for any information you need along the way:

1. Check that Docker and Docker Compose are installed. If not, help me install them.

2. Clone the repo:
   git clone https://github.com/Stink-O/Homefield.git
   cd Homefield

3. I need to set up a Google Cloud project with the Gemini Enterprise API (aiplatform.googleapis.com, formerly the Vertex AI API) enabled. Walk me through what to do in the Google Cloud Console. If I already have a project, use that.

4. Walk me through creating a service account with the "Vertex AI User" role (roles/aiplatform.user, may appear under Gemini Enterprise branding) and downloading a JSON key. Then help me strip all the newlines out of it so it's a single line.

5. Run the setup script and help me fill in each prompt:
   bash setup.sh

   Or if I'd rather do it manually, help me create homefield.env in the repo root with:
   AUTH_SECRET        (generate with: openssl rand -base64 32)
   AUTH_TRUST_HOST=true
   AUTH_URL           (the URL I'll access the app from, e.g. http://localhost:3000)
   GOOGLE_APPLICATION_CREDENTIALS_JSON  (the single-line JSON key from step 4)
   GENERATION_PROVIDER=vertex
   NODE_ENV=production

   Then start it:
   docker compose -f docker-compose.homelab.yml up -d

6. Once the app is running, open it in a browser. You'll be directed to /setup to create the first admin account. Fill in a username, email, and password.

Let me know when everything is up and I can log in.
```

> [!TIP]
> The agent walks you through Docker setup and first login. Google Cloud Console steps (project creation, service account, API enable) require manual browser actions in your Google account.

---

## Self-Hosting with Docker

```bash
git clone https://github.com/Stink-O/Homefield.git
cd Homefield
bash setup.sh
```

The setup script handles configuration, pulls the image, and starts the container.

### Manual setup

Create `homefield.env` in the repo root:

```env
AUTH_SECRET=           # openssl rand -base64 32
AUTH_TRUST_HOST=true
AUTH_URL=              # e.g. http://localhost:3000
GOOGLE_APPLICATION_CREDENTIALS_JSON=   # service account JSON as a single line
GENERATION_PROVIDER=vertex
REPLICATE_API_TOKEN=   # only needed if GENERATION_PROVIDER=replicate
NODE_ENV=production
```

Then start it:

```bash
docker compose -f docker-compose.homelab.yml up -d
```

### Auto-updates

Every push to `master` publishes a new image to `ghcr.io/stink-o/homefield:latest`. [Watchtower](https://containrrr.dev/watchtower/) will pick it up and restart the container automatically.

---

## Local Development

```bash
git clone https://github.com/Stink-O/Homefield.git
cd Homefield/web
cp .env.example .env.local
npm install
npm run dev:http
```

Open `http://localhost:3000`. For HTTPS in dev, drop `cert.pem` and `key.pem` in `web/` (use [mkcert](https://github.com/FiloSottile/mkcert)) and run `npm run dev` instead.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `AUTH_SECRET` | Yes | Generate with `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | Yes | Set to `true` |
| `AUTH_URL` | Yes | Full URL the app is served from |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Yes | Service account JSON as a single line |
| `GENERATION_PROVIDER` | No | `vertex` (default) or `replicate` |
| `REPLICATE_API_TOKEN` | No | Only needed if using Replicate |

### Google credentials

1. Enable the **Gemini Enterprise API** (`aiplatform.googleapis.com`) in [Google Cloud Console](https://console.cloud.google.com)
2. Create a service account with the **Vertex AI User** role (`roles/aiplatform.user`) and download the JSON key
3. Remove all newlines from the file so it's one line, paste it as `GOOGLE_APPLICATION_CREDENTIALS_JSON`

### Using Replicate instead of Vertex

If you'd rather skip the Google Cloud setup for image generation, HomeField can route image models through [Replicate](https://replicate.com):

1. Create a Replicate account and generate a token under [Account settings, API tokens](https://replicate.com/account/api-tokens)
2. Set these in your env file:

```env
GENERATION_PROVIDER=replicate
REPLICATE_API_TOKEN=r8_...
```

The image models map to Replicate's hosted versions of the same Google models (see `web/lib/replicate.ts`):

| HomeField model | Replicate model |
|---|---|
| Nano Banana 2 (`gemini-3.1-flash-image`) | [`google/nano-banana-2`](https://replicate.com/google/nano-banana-2) |
| Nano Banana Pro (`gemini-3-pro-image`) | [`google/nano-banana-pro`](https://replicate.com/google/nano-banana-pro) |

Trade-offs to be aware of:

- **Simpler setup:** just a token, no Google Cloud project, service account, or JSON key
- **Same underlying models**, billed at Replicate's per-image rates instead of Google's
- **Automatic fallback:** if a Replicate call fails and `GOOGLE_APPLICATION_CREDENTIALS_JSON` is also configured, the request retries on Vertex, so you can run both for resilience
- **Rate limits:** Replicate throttles bursts on new accounts; HomeField retries 429s automatically, but large batches may queue
- **Music generation still needs Google credentials.** Lyria is only available through the Google API, so a Replicate-only setup covers images but not music

---

## First Login

When you open HomeField for the first time, you'll be directed to `/setup` to create the initial admin account. Fill in a username, email, and password, and that's it. The setup page disables itself once an admin exists.

After that, new accounts require admin approval before they can generate anything. Everything is managed from the Admin panel in the app.

---

## Agent Access (MCP)

HomeField exposes a [Model Context Protocol](https://modelcontextprotocol.io) server at `/api/mcp`, so an AI agent can generate images in your library, browse what it made, and search the prompt template library. It speaks the 2026-07-28 revision and falls back to the 2025 Streamable HTTP transport for older clients.

Set it up from **Settings → Agent access**. The flow walks through naming the agent, choosing where it may write, what it may do, and what it may spend, then hands you a ready-to-paste command for your client.

### Where agent images go

An API key *is* the agent's identity, so the destination rule lives on the key rather than on each request — an agent cannot talk its way into a workspace you did not grant it.

| Mode | Behaviour |
|---|---|
| **Own workspace** (default) | Creating the key mints a workspace named after the agent. Everything lands there and nowhere else. |
| **Pinned** | The key is locked to one existing workspace you pick. |
| **Any** | The agent chooses per request from your workspaces. |

Nothing writes to your Main workspace unless you allow it. The confinement applies to reads too: a key restricted to one workspace cannot browse the rest of your library.

### Telling agent work apart

Every agent-generated image carries a violet badge with the agent's name on its gallery card and a **Created by** row in the lightbox. The label is stored alongside the image, so it survives revoking the key. Otherwise these are ordinary images — restore to prompt, use as reference, download, move, and delete all work exactly as they do for your own. The header filter scopes the gallery to **Everything / Yours / Agents**.

### Connecting a client

**Claude Code** connects directly:

```bash
claude mcp add --transport http homefield http://your-host:3000/api/mcp --header "Authorization: Bearer hf_live_..."
```

**Claude Desktop and claude.ai** require a public HTTPS URL — they reject `localhost` and LAN addresses. Either put HomeField behind a TLS reverse proxy (Tailscale Funnel and Cloudflare Tunnel both work), or bridge to it with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote). The setup flow generates the right config for each.

> [!WARNING]
> An API key is a bearer token. Over plain HTTP it travels in the clear on your network — worth a TLS proxy if your LAN is not fully trusted. Keys expire after 90 days by default and can be revoked at any time from Settings.

### Checking a connection

If a client reports a connection failure, this says which half is wrong:

```bash
node web/scripts/mcp-check.mjs http://your-host:3000 hf_live_...
```

It separates an unreachable server from a rejected key, lists the tools the key can actually see, and exits non-zero on failure.

### Tools

| | |
|---|---|
| **Generating** | `generate_image`, `get_generation_status`, `cancel_generation` |
| **Library** | `list_images`, `get_image`, `move_image` |
| **Organising** | `list_workspaces`, `create_workspace` |
| **Prompts** | `search_templates`, `save_template` |
| **Destructive** *(off by default)* | `delete_image`, `publish_image`, `unpublish_image` |

Editing is `generate_image` with `reference_image_ids` — there is no separate edit tool. Tools return a small preview inline plus a link to the full-resolution file, so a 4K image never floods the agent's context.

New keys get the `generate` scope only. Deleting and publishing must be granted deliberately, and a key can also be capped to a maximum model, a maximum resolution, and a daily image budget.

### Whose credit gets spent

By default every account generates against the instance-wide Google key. Admins can move any user to their own service-account key from the Admin panel, in which case that user's generations — and their agents' — bill to their own Google project.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| Animation | Framer Motion |
| AI (Image and Music) | Google Gemini Enterprise, formerly Vertex AI (Gemini, Imagen, Lyria) |
| AI (Fallback) | Replicate |
| Database | SQLite via Drizzle ORM + better-sqlite3 |
| Auth | NextAuth v5 |
| Real-time | Server-Sent Events (SSE) |
| Image processing | Sharp |
| Audio waveforms | Wavesurfer.js |

---

## Roadmap

- [ ] Video generation
- [ ] Prompt chaining and multi-step workflows
- [x] Agentic use (MCP server / tool API for AI agents to generate and manage images)
- [ ] Local model support (Ollama / ComfyUI)
- [ ] Shareable prompt packs
- [ ] Native mobile app
