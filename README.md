# HomeField Studio

A self-hosted AI image generation studio built on Google Vertex AI. Generate images from text prompts, attach reference images, organise work into workspaces, and watch generations land in real time across every open tab.

---

## Features

- **Two generation models** — Nano Banana 2 (fast) and Nano Banana Pro (flagship), both powered by Google Gemini image generation
- **Music generation** — text-to-music via Google Lyria with BPM, duration, intensity, and lyrics controls
- **Reference images** — attach up to 14 images per prompt to guide style, composition, or subject
- **Aspect ratios & quality** — 11 aspect ratio presets and 1K / 2K / 4K output resolution
- **Batch generation** — run multiple generations from a single prompt simultaneously
- **Real-time sync** — SSE-based live updates across all open tabs and devices on the same account
- **Workspaces** — organise generations into separate project spaces
- **Shared gallery** — a public-facing view for broadcasting generations live to others
- **Search grounding** — optionally ground generation in real-time web data (Nano Banana 2 only)
- **Drag and drop** — drag images directly onto the prompt window to attach as references
- **Templates** — searchable prompt template library
- **Admin panel** — user management and approval flow
- **Dark glass UI** — fully dark-themed interface with smooth animations

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Animation | Framer Motion |
| AI — Primary | Google Vertex AI (Gemini + Imagen) |
| AI — Fallback | Replicate |
| Database | SQLite via Drizzle ORM + better-sqlite3 |
| Auth | NextAuth v5 |
| Image processing | Sharp |
| Real-time | Server-Sent Events (SSE) |

---

## Self-Hosting with Docker

The recommended way to run HomeField in production is via Docker with auto-updates through GitHub Actions and Watchtower.

### 1. Authenticate with GHCR (one-time)

Since the image is private, your server needs a GitHub PAT with `read:packages` scope:

```bash
echo YOUR_GITHUB_PAT | docker login ghcr.io -u Stink-O --password-stdin
```

Generate a PAT at GitHub > Settings > Developer settings > Personal access tokens.

### 2. Create `homefield.env` in the repo root (never committed)

| Variable | Description |
|---|---|
| `AUTH_SECRET` | Session signing key. Generate with `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | Set to `true` |
| `AUTH_URL` | The URL your app is served from, e.g. `http://your-server-ip:3000` |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Full service account JSON as a single line string |
| `GENERATION_PROVIDER` | `vertex` (default) or `replicate` |
| `REPLICATE_API_TOKEN` | Required only if using `GENERATION_PROVIDER=replicate` |

### 3. Start the container

```bash
docker compose -f docker-compose.homelab.yml up -d
```

The app will be available at port 3000. The SQLite database and all generated files are stored in `./storage` on the host.

### Auto-updates

Every push to `master` triggers a GitHub Actions build that pushes a new image to GHCR (`ghcr.io/stink-o/homefield:latest`). Watchtower detects the updated image and restarts the container automatically — no manual steps required.

---

## Local Development

## Requirements

- Node.js 18+
- A Google Cloud project with Vertex AI API enabled
- A service account with the `Vertex AI User` role
- npm

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/Stink-O/Homefield.git
cd homefield/web
npm install
```

### 2. Configure environment

Copy the example env file and fill in your values:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|---|---|---|
| `AUTH_SECRET` | Yes | Session signing key. Generate with `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | Yes | Set to `true` |
| `AUTH_URL` | Yes | The URL your app is served from, e.g. `http://localhost:3000` |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Yes | Full service account JSON as a single line string |
| `GENERATION_PROVIDER` | No | `vertex` (default) or `replicate` |
| `REPLICATE_API_TOKEN` | No | Required only if using `GENERATION_PROVIDER=replicate` |
| `HTTPS_KEY_PATH` | No | Path to TLS key — only needed for `npm run serve` |
| `HTTPS_CERT_PATH` | No | Path to TLS cert — only needed for `npm run serve` |

#### Getting your Google credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com) and enable the **Vertex AI API**
2. Create a service account with the **Vertex AI User** role
3. Generate a JSON key for the service account
4. Paste the entire JSON as a single line into `GOOGLE_APPLICATION_CREDENTIALS_JSON`

### 3. Run

```bash
# Development (HTTP)
npm run dev:http

# Development (HTTPS — requires cert.pem and key.pem in web/)
npm run dev

# Production
npm run build
npm run start
```

The database and storage directory are created automatically on first boot. No migration step needed.

---

## Project Structure

```
HomeField/
├── web/                        # Next.js application
│   ├── app/                    # App Router pages and API routes
│   │   ├── api/generate/       # Image generation endpoint
│   │   ├── api/images/         # Image management
│   │   ├── api/workspaces/     # Workspace management
│   │   └── shared/             # Shared gallery page
│   ├── components/             # React components
│   ├── contexts/               # Global state (AppContext)
│   ├── lib/                    # Utilities, DB, storage, types
│   │   ├── db/                 # Drizzle schema and migrations
│   │   ├── gemini.ts           # Generation client
│   │   └── fileStorage.ts      # Image file management
│   ├── public/                 # Static assets
│   └── scripts/                # Utility scripts
└── storage/                    # Runtime data — gitignored, auto-created
    ├── homefield.db            # SQLite database
    └── images/                 # Generated image files
```

---

## First Login

Registration is open by default but accounts require admin approval before they can generate. The first user to register should be promoted to admin directly in the database:

```bash
cd web
npx ts-node scripts/seed.ts
```

Or manually update the `approved` and `role` columns in `storage/homefield.db` using any SQLite client.

---

## HTTPS in Development

The `npm run dev` script expects `cert.pem` and `key.pem` in the `web/` directory. A convenient way to generate them is with [mkcert](https://github.com/FiloSottile/mkcert):

```bash
mkcert -install
mkcert localhost 127.0.0.1 YOUR_LOCAL_IP
# Rename the generated files to cert.pem and key.pem
```

Both files are gitignored.

---

## License

Private — all rights reserved.
