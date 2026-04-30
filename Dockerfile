# syntax=docker/dockerfile:1

# ── Stage 1: Install dependencies (compiles better-sqlite3 native binding) ────
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++

WORKDIR /app/web

COPY web/package.json web/package-lock.json ./
RUN npm ci

# ── Stage 2: Build the Next.js app ────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app/web

COPY --from=deps /app/web/node_modules ./node_modules
COPY web/ .

ENV NODE_OPTIONS=--max-old-space-size=4096
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Stage 3: Production runtime ───────────────────────────────────────────────
FROM node:22-alpine AS runner

RUN apk add --no-cache tini

WORKDIR /app/web

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOST=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Standalone output includes a minimal node_modules with the compiled .node binary
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
# Static assets are not included in standalone output
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/web/public ./public
# Migrations must be present at process.cwd()/lib/db/migrations on startup
COPY --from=builder --chown=nextjs:nodejs /app/web/lib/db/migrations ./lib/db/migrations
# Template data (chunks + embeddings) needed by the For You feature
COPY --from=builder --chown=nextjs:nodejs /app/web/data ./data

# Pre-create storage dir — volume mount overlays this, but prevents crash on empty first boot
RUN mkdir -p /app/storage && chown -R nextjs:nodejs /app/storage

USER nextjs

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
