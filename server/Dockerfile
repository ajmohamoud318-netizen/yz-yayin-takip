# Production image for the Fastify backend.
#
# Dokploy uses this Dockerfile when "Build Pack = Dockerfile" and
# Build Path = /server is selected. The image is also what `docker compose`
# builds locally (see ../docker-compose.yml — `context: ./server`).
#
# Two-stage build:
#   1. deps    — install production-only node_modules from package-lock.json
#   2. runtime — node:20-alpine, only the source tree + prod node_modules
#
# Runtime notes:
#   • binds on PORT (default 4000) for Fastify
#   • exposes HEALTHCHECK against GET /api/health
#   • runs the entrypoint as root so it can chown the persistent upload
#     directory (Dokploy creates mounted volumes root-owned by default);
#     the entrypoint then `exec`s into the unprivileged `node` user
#     before launching Fastify. The actual Node process never runs as root.
#   • CMD is `node` directly so PID 1 receives SIGTERM/SIGINT and the
#     graceful shutdown handlers in src/index.js actually run. Going through
#     `npm start` would swallow the signal and force a hard kill.

# ---------- Stage 1: install production deps ----------
FROM node:20-alpine AS deps
WORKDIR /app

# Copy manifests first so the install layer caches across source-only edits.
# `package-lock.json*` tolerates a missing lockfile (falls back to npm install).
COPY package.json package-lock.json* ./

# --omit=dev is explicit even though this package currently has no devDeps;
# keeps the image lean if any dev-only tooling slips into package.json later.
# The `||` fallback only kicks in if the lockfile is genuinely absent — the
# server folder ships a committed server/package-lock.json.
RUN npm ci --omit=dev --no-audit --no-fund || \
    (echo "lockfile missing; falling back to npm install" && \
     npm install --omit=dev --no-audit --no-fund)


# ---------- Stage 2: runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Sensible defaults — Dokploy env vars still override these per-service.
ENV PORT=4000
ENV HOST=0.0.0.0

# Production node_modules from the deps stage.
COPY --from=deps /app/node_modules ./node_modules

# Source tree (routes, services, migrations, seed fixtures, etc.).
# Build-time git SHA — surfaced via `GET /api/health` so a curl can tell
# at a glance whether the running container is on the latest commit. Pass
# with `docker build --build-arg GIT_COMMIT=$(git rev-parse HEAD) .` or set
# it as a Dokploy build-arg. Falls back to "unknown" if unset (e.g. local
# builds without git history).
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}

# .dockerignore excludes .git, .env, tests, and other dev-only files.
COPY . .

# gosu lets a root-owned entrypoint drop to a specific user via
# `gosu <user> <cmd...>` — without it we'd need to deal with su's
# SIGCHLD / pty quirks. Available in the alpine community repo.
RUN apk add --no-cache gosu

# The official node:20-alpine image ships a non-root `node` user
# (UID 1000). Stay as root for the entrypoint (which has to chown
# the on-disk upload dir that Dokploy creates root-owned), then
# the entrypoint `exec`s into the node user right before launching
# Fastify. The Fastify process itself runs unprivileged — root is
# only used for the mkdir/chown/chmod that prepares persistent
# state, in a single tightly-scoped moment at boot.
USER root

# Copy the entrypoint that prepares the avatar upload dir then drops
# privileges. Idempotent: safe on every boot, not just first deploy.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4000

# Container-level health probe. Fastify exposes GET /api/health (see
# src/index.js). wget is provided by BusyBox on Alpine, so no extra pkg.
# - start-period=15s gives migrations time to apply on first boot.
# - interval=30s / timeout=5s / retries=3 = standard Dokploy probe defaults.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:4000/api/health || exit 1

# Run via entrypoint (which chowns the upload dir then drops to the
# `node` user) instead of `node` directly. `exec` inside the
# entrypoint makes the Fastify process PID 1 so SIGTERM reaches it
# and graceful shutdown closes the pg pool cleanly.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
