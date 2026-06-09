# HomeField Studio

> Private AI studio for image and music generation, runs on your own hardware.

[![GitHub Stars](https://img.shields.io/github/stars/Stink-O/Homefield?style=social)](https://github.com/Stink-O/Homefield/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/Stink-O/Homefield)](https://github.com/Stink-O/Homefield/commits/master)
[![Docker](https://img.shields.io/badge/docker-ghcr.io-blue?logo=docker)](https://github.com/Stink-O/Homefield/pkgs/container/homefield)
[![License](https://img.shields.io/badge/license-proprietary-red)](#license)

HomeField runs on Google Vertex AI — Gemini, Imagen, and Lyria. No subscription, no per-generation fees, nothing leaves your network. Clone the repo, run the setup script, and you have a private AI studio running on your own hardware.

If you've used [Higgsfield](https://higgsfield.ai) or [Adobe Firefly](https://firefly.adobe.com), it's the same gallery-first generation experience — except you own the server, pay nothing per image, and your prompts never touch anyone else's infrastructure.

![HomeField desktop gallery view](Github_Homefield_Desktop_view_image.png)

HomeField has full mobile support. Everything works on your phone.

<table>
  <tr>
    <td><img src="Github_Homefield_Mobile_view_image.png" alt="HomeField mobile gallery view" width="360"/></td>
    <td><img src="Github_Homefield_Mobile_prompt_window_view_image.png" alt="HomeField mobile prompt sheet" width="360"/></td>
  </tr>
</table>

<!-- DEMOS: drop animated GIFs here once recorded. See below for what to capture. -->
<!-- image-generation-demo.gif — prompt → generate → image appears in gallery -->
<!-- music-generation-demo.gif — music prompt → waveform plays -->

---

## Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Quick Start](#set-up-with-an-ai-agent)
- [Self-Hosting with Docker](#self-hosting-with-docker)
- [Local Development](#local-development)
- [First Login](#first-login)
- [Tech Stack](#tech-stack)
- [Roadmap](#roadmap)

---

## Features

### Image Generation

- **Models:** Nano Banana 2 (fast) and Nano Banana Pro (flagship)
- **Reference images:** attach up to 14 per prompt to guide style or composition
- **Aspect ratios:** Auto, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
- **Resolution:** 1K, 2K, or 4K output
- **Batch generation:** run multiple generations from the same prompt at once
- **Search grounding:** optionally anchor generations in live web context

### Music Generation

- **Text-to-music** via Google Lyria
- **Duration:** 30s, 60s, 3 min, 4 min
- **Controls:** BPM, intensity, instrumental toggle, custom lyrics, watermark
- **Models:** Lyria 3 Pro Preview and Lyria 3 Clip Preview

### Organisation

- **Project workspaces** to separate generations by project or client
- **Prompt template library** with categories, favourites, and "For You" recommendations based on your history
- **Cross-device sync** so everything follows your account across devices and tabs

### Collaboration

- **Live pending states:** generations started anywhere show up on every open session in real time
- **Shared gallery** for broadcasting to a public live feed
- **Multi-user support** with admin-controlled account approval
- **Admin panel** for managing users, roles, and backups

---

## Prerequisites

Before you start you'll need:

- **Docker and Docker Compose** — [install Docker](https://docs.docker.com/get-docker/)
- **A Google Cloud project** with the [Vertex AI API](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com) enabled
- **A service account JSON key** with the **Vertex AI User** role

That's it. No GPU required — generation runs on Google's infrastructure.

---

## Set Up with an AI Agent

Paste this into any AI agent (Claude, ChatGPT, Gemini, etc.) and it will walk you through the entire setup:

```
I want to self-host HomeField Studio, an AI image and music generation web app that runs on Google Vertex AI. Help me get it running from scratch.

Work through these steps in order, confirm each one is done before moving on, and ask me for any information you need along the way:

1. Check that Docker and Docker Compose are installed. If not, help me install them.

2. Clone the repo:
   git clone https://github.com/Stink-O/Homefield.git
   cd Homefield

3. Help me set up a Google Cloud project with the Vertex AI API enabled. If I already have one, use that.

4. Create a service account with the "Vertex AI User" role, download a JSON key, and help me strip all the newlines out of it so it's a single line.

5. Run the setup script and help me fill in each prompt:
   bash setup.sh

   Or if I'd rather do it manually, help me create homefield.env in the repo root with:
   AUTH_SECRET        (generate with: openssl rand -base64 32)
   AUTH_TRUST_HOST=true
   AUTH_URL           (the URL I'll access the app from, e.g. http://192.168.1.100:3000)
   GOOGLE_APPLICATION_CREDENTIALS_JSON  (the single-line JSON key from step 4)
   GENERATION_PROVIDER=vertex
   NODE_ENV=production

   Then start it:
   docker compose -f docker-compose.homelab.yml up -d

6. Once the app is running, help me register an account and promote it to admin by running this against storage/homefield.db:
   UPDATE users SET role = 'admin', approved = 1 WHERE email = 'my@email.com';

Let me know when everything is up and I can log in.
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| Animation | Framer Motion |
| AI (Image and Music) | Google Vertex AI (Gemini, Imagen, Lyria) |
| AI (Fallback) | Replicate |
| Database | SQLite via Drizzle ORM + better-sqlite3 |
| Auth | NextAuth v5 |
| Real-time | Server-Sent Events (SSE) |
| Image processing | Sharp |
| Audio waveforms | Wavesurfer.js |

---

## Self-Hosting with Docker

**You'll need:** Docker and Docker Compose, a Google Cloud project with the Vertex AI API enabled, and a service account JSON key with the Vertex AI User role.

```bash
git clone https://github.com/Stink-O/Homefield.git
cd Homefield
bash setup.sh
```

The script handles configuration, pulls the image, and starts the container.

### Manual setup

Create `homefield.env` in the repo root:

```env
AUTH_SECRET=           # openssl rand -base64 32
AUTH_TRUST_HOST=true
AUTH_URL=              # e.g. http://192.168.1.100:3000
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

1. Enable the **Vertex AI API** in [Google Cloud Console](https://console.cloud.google.com)
2. Create a service account with the **Vertex AI User** role and download the JSON key
3. Remove all newlines from the file so it's one line, paste it as `GOOGLE_APPLICATION_CREDENTIALS_JSON`

---

## First Login

Register an account once the app is running. New accounts need admin approval before they can generate anything.

There are no admins on first boot, so promote your first user manually:

```sql
UPDATE users SET role = 'admin', approved = 1 WHERE email = 'you@example.com';
```

Database is at `storage/homefield.db` in Docker, or `web/storage/homefield.db` locally. After that, everything is managed from the Admin panel in the app.

---

## Roadmap

- [ ] Video generation
- [ ] Prompt chaining and multi-step workflows
- [ ] Local model support (Ollama / ComfyUI)
- [ ] Shareable prompt packs
- [ ] Native mobile app

---

## License

All rights reserved.
