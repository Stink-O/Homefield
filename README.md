# HomeField Studio

> Your own private AI studio for image and music generation, running entirely on your hardware.

HomeField runs on Google Vertex AI (Gemini, Imagen, Lyria) with no SaaS subscription, no usage dashboard, and nothing leaving your network. One command to spin up, register an account, and you're generating.

If you use [Higgsfield](https://higgsfield.ai) for its gallery-style image generation interface, HomeField is the self-hosted version of that idea. Same clean gallery UX, no per-generation costs, runs on your own infrastructure.

![HomeField desktop gallery view](Github_Homefield_Desktop_view_image.png)

---

## What is it?

HomeField is a web app you host yourself. It pulls together a bunch of features that are usually spread across multiple paid tools:

- **Image generation** from text prompts, with reference image support, aspect ratio control, and resolution options up to 4K
- **Music generation** from text descriptions, with control over tempo, mood, intensity, and lyrics
- **Project workspaces** to keep generations organised by project, client, or concept
- **Real-time collaboration** so anything generated on one device or tab shows up live everywhere else
- **Shared gallery** for broadcasting generations to a live feed others can watch
- **User management** with an admin approval flow so you decide who gets access

Good fit for homelab setups, creative professionals, and small teams who want a private studio without recurring costs.

---

## Features

### Image Generation

- **Models:** Nano Banana 2 (fast, high quality) and Nano Banana Pro (flagship)
- **Reference images:** attach up to 14 per prompt to guide style, composition, or subject
- **Aspect ratios:** Auto, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
- **Resolution:** 1K, 2K, or 4K output
- **Batch generation:** run multiple generations from the same prompt at once
- **Search grounding:** optionally anchor the generation in live web context
- **Batch operations:** select multiple images to download or delete in one go

### Music Generation

- **Text-to-music** via Google Lyria: describe what you want, get audio back
- **Duration presets:** 30s, 60s, 3 minutes, 4 minutes
- **Controls:** BPM, intensity (0-1.0), instrumental toggle, custom lyrics, watermark control
- **Two Lyria models:** Lyria 3 Pro Preview (high quality) and Lyria 3 Clip Preview (fast)

### Workspaces and Organisation

- **Project workspaces** for keeping generations organised by project, client, or concept
- **Prompt template library:** a curated collection sorted by category, plus your own saved templates synced across devices
- **Favourites:** star templates to pin them to the top
- **"For You" recommendations:** template suggestions pulled from your generation history
- **Searchable history** across everything you've ever generated

### Real-time Sync and Collaboration

- **Cross-device sync:** generations, templates, and images follow your account and appear instantly on every open device or tab
- **Live pending states:** when a generation kicks off anywhere, a shimmer placeholder appears on all other sessions and resolves when it finishes
- **Shared gallery:** broadcast any generation to a public live feed
- **Multi-user support:** each user gets their own history, workspaces, and templates; new accounts need admin approval before they can generate

### Administration

- **Admin panel** for managing users, approving registrations, and changing roles
- **Import/export** for full backups as a ZIP file including all images and metadata

---

## Screenshots

HomeField has full mobile support. The entire workflow, gallery, workspaces, and templates are all there on your phone.

<table>
  <tr>
    <td><img src="Github_Homefield_Mobile_view_image.png" alt="HomeField mobile gallery view" width="360"/></td>
    <td><img src="Github_Homefield_Mobile_prompt_window_view_image.png" alt="HomeField mobile prompt sheet" width="360"/></td>
  </tr>
</table>

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

The script asks you a few questions, writes a `homefield.env` file, pulls the Docker image, and starts the container. When it finishes, the app is up at whatever URL you entered.

### Manual setup (skip the script)

Create `homefield.env` in the repo root:

```env
AUTH_SECRET=           # openssl rand -base64 32
AUTH_TRUST_HOST=true
AUTH_URL=              # e.g. http://192.168.1.100:3000
GOOGLE_APPLICATION_CREDENTIALS_JSON=   # full service account JSON as a single line
GENERATION_PROVIDER=vertex
REPLICATE_API_TOKEN=   # only required if GENERATION_PROVIDER=replicate
NODE_ENV=production
```

Then start it:

```bash
docker compose -f docker-compose.homelab.yml up -d
```

### Auto-updates

Every push to `master` builds and publishes a new image to `ghcr.io/stink-o/homefield:latest`. If you have [Watchtower](https://containrrr.dev/watchtower/) running, it picks up the new image and restarts the container automatically.

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
| `AUTH_SECRET` | Yes | Session signing key, generate with `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | Yes | Set to `true` |
| `AUTH_URL` | Yes | The full URL the app is served from (e.g. `http://localhost:3000`) |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Yes | Full service account JSON pasted as a single line |
| `GENERATION_PROVIDER` | No | `vertex` (default) or `replicate` |
| `REPLICATE_API_TOKEN` | No | Required only if `GENERATION_PROVIDER=replicate` |
| `HTTPS_KEY_PATH` | No | Path to TLS private key, only needed for `npm run serve` |
| `HTTPS_CERT_PATH` | No | Path to TLS certificate, only needed for `npm run serve` |

### Getting Google credentials

1. Open [Google Cloud Console](https://console.cloud.google.com) and enable the **Vertex AI API** on your project
2. Go to **IAM & Admin > Service Accounts** and create a new service account
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

Once the app is running, register an account in your browser. **New accounts can't generate anything until an admin approves them.**

Since there are no admins yet, you'll need to promote your first account manually through a SQLite client (any GUI tool or the `sqlite3` CLI):

```sql
UPDATE users SET role = 'admin', approved = 1 WHERE email = 'you@example.com';
```

The database lives at `storage/homefield.db` in Docker, or `web/storage/homefield.db` in local dev.

After that, user management is all in-app from the Admin panel. No more SQL required.

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
├── storage/                     # Runtime data (DB + generated files), gitignored
├── docker-compose.homelab.yml   # Production Docker Compose
├── Dockerfile                   # Multi-stage build
└── setup.sh                     # Interactive first-boot setup script
```

---

## License

All rights reserved.
