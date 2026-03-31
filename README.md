# HomeField Studio

> A self-hosted AI creative studio for generating images and music. Dark glass UI, real-time sync, multi-user with admin approval, and one-command Docker deployment.

Built on Google Vertex AI (Gemini, Imagen, Lyria). Runs entirely on your own hardware.

---

## Features

**Image Generation**
- Two models: Nano Banana 2 (fast) and Nano Banana Pro (flagship)
- Attach up to 14 reference images per prompt to guide style and composition
- 11 aspect ratio presets, 1K / 2K / 4K output resolution
- Run multiple generations from a single prompt simultaneously
- Search grounding — optionally anchor generation in real-time web data

**Music Generation**
- Text-to-music via Google Lyria
- Controls for BPM, duration, intensity, instrumental mode, and custom lyrics

**Workspace and Organisation**
- Separate project workspaces
- Searchable prompt template library with thumbnail previews
- Batch select, download, or delete

**Collaboration**
- Real-time sync across all open tabs and devices via SSE
- Shared gallery — broadcast generations live to others
- Multi-user with registration and admin approval flow

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Animation | Framer Motion |
| AI | Google Vertex AI (Gemini, Imagen, Lyria) |
| AI fallback | Replicate |
| Database | SQLite via Drizzle ORM + better-sqlite3 |
| Auth | NextAuth v5 |
| Real-time | Server-Sent Events (SSE) |

---

## Self-Hosting with Docker

### Prerequisites

- Docker and Docker Compose
- A Google Cloud project with Vertex AI API enabled
- A service account with the **Vertex AI User** role

### 1. Clone the repo

```bash
git clone https://github.com/Stink-O/Homefield.git
cd Homefield
```

### 2. Run the setup script

```bash
bash setup.sh
```

This prompts for all required values, writes `homefield.env`, and starts the container. The app will be available at the URL you provide during setup.

### Manual setup (alternative)

Create `homefield.env` in the repo root:

```env
AUTH_SECRET=        # openssl rand -base64 32
AUTH_TRUST_HOST=true
AUTH_URL=           # e.g. http://192.168.1.100:3000
GOOGLE_APPLICATION_CREDENTIALS_JSON=   # full service account JSON, single line
GENERATION_PROVIDER=vertex
REPLICATE_API_TOKEN=    # only needed if GENERATION_PROVIDER=replicate
NODE_ENV=production
```

Then start the container:

```bash
docker compose -f docker-compose.homelab.yml up -d
```

### Auto-updates with Watchtower

Every push to `master` triggers a GitHub Actions build that pushes a new image to `ghcr.io/stink-o/homefield:latest`. If you have [Watchtower](https://containrrr.dev/watchtower/) in your stack, it will detect the updated image and restart the container automatically.

---

## Local Development

### Requirements

- Node.js 18+
- A Google Cloud project with Vertex AI API enabled
- npm

### Setup

```bash
git clone https://github.com/Stink-O/Homefield.git
cd Homefield/web
cp .env.example .env.local   # fill in your values
npm install
npm run dev:http
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `AUTH_SECRET` | Yes | Session signing key — `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | Yes | Set to `true` |
| `AUTH_URL` | Yes | The URL the app is served from |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Yes | Full service account JSON as a single line |
| `GENERATION_PROVIDER` | No | `vertex` (default) or `replicate` |
| `REPLICATE_API_TOKEN` | No | Required if using `GENERATION_PROVIDER=replicate` |
| `HTTPS_KEY_PATH` | No | Path to TLS key — only needed for `npm run serve` |
| `HTTPS_CERT_PATH` | No | Path to TLS cert — only needed for `npm run serve` |

### Getting Google credentials

1. Enable the **Vertex AI API** in [Google Cloud Console](https://console.cloud.google.com)
2. Create a service account with the **Vertex AI User** role
3. Generate a JSON key and paste the entire contents as a single line into `GOOGLE_APPLICATION_CREDENTIALS_JSON`

### HTTPS in development

The `npm run dev` script expects `cert.pem` and `key.pem` in `web/`. Generate them with [mkcert](https://github.com/FiloSottile/mkcert):

```bash
mkcert -install
mkcert localhost 127.0.0.1 YOUR_LOCAL_IP
# rename the output files to cert.pem and key.pem
```

---

## First Login

Accounts require admin approval before they can generate. After registering, promote the first user to admin via any SQLite client:

```sql
UPDATE users SET role = 'admin', approved = 1 WHERE email = 'you@example.com';
```

The database is at `storage/homefield.db`.

---

## Project Structure

```
HomeField/
├── web/                    # Next.js application
│   ├── app/                # App Router pages and API routes
│   ├── components/         # React components
│   ├── contexts/           # Global state
│   └── lib/                # Utilities, DB schema, types
├── docker-compose.homelab.yml
├── Dockerfile
└── setup.sh                # First-boot setup script
```

---

## License

All rights reserved.
