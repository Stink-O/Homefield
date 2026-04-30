# HomeField Studio

> A self-hosted AI creative studio for generating images and music — built for people who want full control over their creative workflow.

HomeField runs entirely on your own hardware using Google Vertex AI (Gemini, Imagen, Lyria). There is no usage dashboard, no SaaS subscription, and no data leaving your infrastructure. Spin it up with a single command, register an account, and start generating.

If you use [Higgsfield](https://higgsfield.ai) for its image generation gallery, HomeField is a self-hosted alternative — same idea of a clean gallery-style interface for AI image generation, but running on your own infrastructure with no per-generation costs.

---

## What is it?

HomeField Studio is a web app you host yourself. It gives you a clean, fast interface for AI image and music generation, with features typically scattered across multiple paid tools brought together in one place:

- **Generate images** from text prompts with reference image support, aspect ratio control, and multiple resolution options
- **Generate music** from text descriptions with full control over tempo, mood, intensity, and lyrics
- **Organise your work** into project workspaces with a searchable prompt template library
- **Collaborate in real time** — any generation started on one device or tab appears live on every other open session
- **Share generations** to a live gallery that others can watch in real time
- **Manage users** with an admin approval flow so you control who has access

It's built for homelab setups, creative professionals, and teams who want a private, fast, self-contained studio.

---

## Features

### Image Generation

- **Two models** — Nano Banana 2 (fast, high quality) and Nano Banana Pro (flagship)
- **Reference images** — attach up to 14 reference images per prompt to guide style, composition, or subject
- **Aspect ratio presets** — Auto, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
- **Resolution options** — 1K, 2K, or 4K output
- **Batch generation** — run multiple generations from a single prompt simultaneously
- **Search grounding** — optionally anchor the generation in real-time web context
- **Batch operations** — select multiple images to download or delete at once

### Music Generation

- **Text-to-music** via Google Lyria — describe the music you want and it generates it
- **Duration presets** — 30s, 60s, 3 minutes, 4 minutes
- **Detailed controls** — BPM, intensity (0–1.0), instrumental toggle, custom lyrics, watermark control
- **Two Lyria models** — Lyria 3 Pro Preview (high quality) and Lyria 3 Clip Preview (fast)

### Workspaces and Organisation

- **Project workspaces** — keep your generations organised by project, client, or concept
- **Prompt template library** — a built-in library of curated prompt templates sorted by category, plus your own saved templates synced to your account across devices
- **Favourites** — star templates to access them instantly
- **"For You" recommendations** — AI-powered template suggestions based on your generation history
- **Searchable history** — full-text search across everything you've generated

### Real-time Sync and Collaboration

- **Cross-device sync** — generations, templates, and images are tied to your account and appear instantly on every open device or tab
- **Live pending states** — when a generation starts anywhere, a shimmer placeholder appears everywhere else, then resolves when it completes
- **Shared gallery** — broadcast any generation to a public live feed that others can watch in real time
- **Multi-user support** — each user has their own history, workspaces, and templates; accounts require admin approval before access is granted

### Administration

- **Admin panel** — manage users, approve registrations, promote or demote roles
- **Import/export** — full backup as a ZIP archive including all images and metadata

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| Animation | Framer Motion |
| AI — Image & Music | Google Vertex AI (Gemini, Imagen, Lyria) |
| AI — Fallback | Replicate |
| Database | SQLite via Drizzle ORM + better-sqlite3 |
| Auth | NextAuth v5 |
| Real-time | Server-Sent Events (SSE) |
| Image processing | Sharp |
| Audio waveforms | Wavesurfer.js |

---

## Self-Hosting with Docker

### Prerequisites

- Docker and Docker Compose installed
- A Google Cloud project with the **Vertex AI API** enabled
- A service account with the **Vertex AI User** role (JSON key required)

### 1. Clone the repo

```bash
git clone https://github.com/Stink-O/Homefield.git
cd Homefield
```

### 2. Run the setup script

```bash
bash setup.sh
```

The script walks you through all required configuration, writes a `homefield.env` file, pulls the latest Docker image, and starts the container. When it finishes, the app is available at the URL you entered.

### Manual setup (alternative to the script)

Create `homefield.env` in the repo root with the following:

```env
AUTH_SECRET=           # openssl rand -base64 32
AUTH_TRUST_HOST=true
AUTH_URL=              # e.g. http://192.168.1.100:3000
GOOGLE_APPLICATION_CREDENTIALS_JSON=   # full service account JSON as a single line
GENERATION_PROVIDER=vertex
REPLICATE_API_TOKEN=   # only required if GENERATION_PROVIDER=replicate
NODE_ENV=production
```

Then start the container:

```bash
docker compose -f docker-compose.homelab.yml up -d
```

### Auto-updates

Every push to `master` builds and publishes a new image to `ghcr.io/stink-o/homefield:latest`. If you run [Watchtower](https://containrrr.dev/watchtower/) in your stack it will detect the new image and restart the container automatically — no manual intervention needed.

---

## Local Development

### Requirements

- Node.js 18 or later
- npm
- A Google Cloud project with the Vertex AI API enabled

### Setup

```bash
git clone https://github.com/Stink-O/Homefield.git
cd Homefield/web
cp .env.example .env.local   # fill in your values (see table below)
npm install
npm run dev:http              # start without HTTPS
```

Open `http://localhost:3000`.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `AUTH_SECRET` | Yes | Session signing key — generate with `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | Yes | Set to `true` |
| `AUTH_URL` | Yes | The full URL the app is served from (e.g. `http://localhost:3000`) |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Yes | Full service account JSON pasted as a single line |
| `GENERATION_PROVIDER` | No | `vertex` (default) or `replicate` |
| `REPLICATE_API_TOKEN` | No | Required only if `GENERATION_PROVIDER=replicate` |
| `HTTPS_KEY_PATH` | No | Path to TLS private key — only needed for `npm run serve` |
| `HTTPS_CERT_PATH` | No | Path to TLS certificate — only needed for `npm run serve` |

### Getting Google credentials

1. Open [Google Cloud Console](https://console.cloud.google.com) and enable the **Vertex AI API** on your project
2. Go to **IAM & Admin → Service Accounts** and create a new service account
3. Grant it the **Vertex AI User** role
4. Create a JSON key and download it
5. Open the file, remove all newlines so it's a single line, and paste it as the value of `GOOGLE_APPLICATION_CREDENTIALS_JSON`

### HTTPS in development

The `npm run dev` script expects `cert.pem` and `key.pem` in `web/`. Use [mkcert](https://github.com/FiloSottile/mkcert) to generate trusted local certificates:

```bash
mkcert -install
mkcert localhost 127.0.0.1 YOUR_LOCAL_IP
# rename the generated files to cert.pem and key.pem and place them in web/
```

For development without HTTPS, use `npm run dev:http` instead.

---

## First Login

After the app starts, open it in your browser and register an account. **Newly registered accounts cannot generate until an admin approves them.**

Since there are no admins yet, you need to promote your first user manually via a SQLite client (any GUI tool or the `sqlite3` CLI):

```sql
UPDATE users SET role = 'admin', approved = 1 WHERE email = 'you@example.com';
```

The database file is at `storage/homefield.db` (relative to the repo root in Docker, or `web/storage/homefield.db` in local dev).

Once you're an admin, you can approve and manage other users from the Admin panel inside the app — no more SQL needed.

---

## Project Structure

```
HomeField/
├── web/                         # Next.js application
│   ├── app/                     # App Router pages and API routes
│   │   ├── api/                 # All API endpoints
│   │   ├── music/               # Music generation page
│   │   ├── shared/              # Live shared gallery page
│   │   └── admin/               # Admin user management page
│   ├── components/              # React components
│   ├── contexts/                # Global app state (AppContext)
│   └── lib/                     # Utilities, DB schema, types, AI clients
├── storage/                     # Runtime data (DB + generated files) — gitignored
├── docker-compose.homelab.yml   # Production Docker Compose
├── Dockerfile                   # Multi-stage build
└── setup.sh                     # Interactive first-boot setup script
```

---

## License

All rights reserved.
