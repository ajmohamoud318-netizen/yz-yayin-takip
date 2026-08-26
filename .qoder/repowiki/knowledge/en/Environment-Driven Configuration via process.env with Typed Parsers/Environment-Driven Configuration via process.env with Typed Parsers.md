---
kind: configuration_system
name: Environment-Driven Configuration via process.env with Typed Parsers
category: configuration_system
scope:
    - '**'
source_files:
    - server/src/config.js
    - server/src/index.js
    - server/Dockerfile
    - server/docker-entrypoint.sh
    - serve.cjs
    - Dockerfile
    - docker-compose.yml
    - .env.example
    - client/vite.config.js
---

## What system/approach is used

The monorepo uses a pure **environment-variable configuration** model. There are no `.env` files committed to the repo (`.env.example` documents every variable), no YAML/TOML/JSON config files, and no runtime config loaders — all settings flow through `process.env`, populated by Dokploy in production and by Docker Compose / Vite locally.

Two separate processes consume configuration:

1. **Fastify backend** (`server/src/config.js`) — reads `process.env` at import time into a single exported `config` object using small typed helpers (`intEnv`, `boolEnv`).
2. **SPA static server** (`serve.cjs`) — reads `PORT`, `HOST`, `API_UPSTREAM` directly from `process.env`.
3. **Vite dev server** (`client/vite.config.js`) — hardcodes the dev proxy target; build-time env vars prefixed `VITE_` are inlined into the bundle by Vite (e.g. `VITE_API_BASE_URL`).

## Key files and packages

- `server/src/config.js` — the single source of truth for backend configuration; exports a flat `config` object consumed by `index.js`, migration runner, seed script, pool, auth middleware, and services.
- `server/src/index.js` — consumes `config` to start Fastify, register plugins (helmet, cookie, multipart), mount routes under `/api`, run migrations/seeds, and listen on `config.host:config.port`.
- `server/Dockerfile` — sets `NODE_ENV=production`, `PORT=4000`, `HOST=0.0.0.0`, injects `GIT_COMMIT` build arg, and runs `node src/index.js` as PID 1 so graceful shutdown works.
- `server/docker-entrypoint.sh` — chowns the persistent upload directory then drops privileges to the unprivileged `node` user before exec'ing the app.
- `serve.cjs` — zero-dependency Node HTTP server that serves `client/dist`, reverse-proxies `/api/*` to `API_UPSTREAM` (default `http://backend:4000`), and sets cache headers.
- `Dockerfile` (root) — builds the Vite SPA with `VITE_API_BASE_URL` as a build arg, outputs `client/dist`, and ships only the built assets plus `serve.cjs`.
- `docker-compose.yml` — defines the local dev stack (postgres, server, client) and injects environment variables (`DATABASE_URL`, `PG_POOL_MAX`, `PORT`, `HOST`, `MIGRATE_ON_BOOT`, `SEED_ON_BOOT`, `TRUST_HEADER_AUTH`, `CORS_ORIGINS`) plus named volumes for DB and uploads.
- `.env.example` — documents every supported environment variable with comments explaining defaults, security implications, and per-environment expectations.
- `client/vite.config.js` — declares the dev proxy `/api → http://localhost:4000`; build-time `VITE_*` variables are baked into the SPA bundle.

## Architecture and conventions

### Centralized typed parsing
`server/src/config.js` defines two tiny parsers — `intEnv(name, fallback)` and `boolEnv(name, fallback)` — that coerce strings to numbers or booleans (`'1'` / `'true'` case-insensitive) and fall back to documented defaults when the env var is missing or empty. Every setting goes through one of these helpers, so consumers never parse `process.env` themselves.

### Defaults are environment-aware
Most values have sensible defaults that differ between development and production based on `process.env.NODE_ENV`:
- `corsOrigins`: defaults to `['http://localhost:5173', 'http://localhost:4173']` in dev, `['https://yt.mucitkarinca.com']` in prod.
- `inviteBaseUrl`: defaults to `http://localhost:5173` in dev, `https://yt.mucitkarinca.com` in prod.
- `session.secure`: defaults to `false` in dev, `true` in prod.
- `redisUrl`: defaults to `redis://localhost:6379` (disabled Redis features if blank).

### Feature toggles via env flags
Behavior is controlled by explicit boolean flags rather than feature branches:
- `MIGRATE_ON_BOOT` — auto-run migrations on startup (enabled in compose, disabled for multi-instance safety).
- `SEED_ON_BOOT` — lazy-import seed runner only when true (seed code is not shipped in production images).
- `TRUST_HEADER_AUTH` — accept `X-User-Id` header as identity (dev convenience; must be `false` in production per the SECURITY_PLAN comment).
- `RATE_LIMIT_STORE` — switch rate limiter backend between `memory` and `redis`.
- `SESSION_COOKIE_SECURE` / `SESSION_COOKIE_SAMESITE` / `SESSION_COOKIE_DOMAIN` — fine-grained cookie policy overrides.

### Two-process deployment model
The SPA and API are separate Dokploy apps:
- The root `Dockerfile` builds the SPA and serves it via `serve.cjs`, which reverse-proxies `/api/*` to the backend service slug (`API_UPSTREAM`, default `http://backend:4000`). This keeps session cookies same-origin (SameSite=lax works without cross-site workarounds).
- The server `Dockerfile` builds the Fastify API image independently.
- Local parity is provided by `docker-compose.yml`, which starts postgres, the server, and the Vite dev client with matching env.

### Build-time vs runtime configuration
- **Build-time** (Vite): `VITE_API_BASE_URL` is passed as a Docker `ARG` and inlined into the SPA bundle at build time. The default is empty so the SPA calls relative `/api`, relying on `serve.cjs` to proxy to the backend.
- **Runtime** (Node): All other settings are read from `process.env` at process start. No config file reload is supported.

### Security posture in configuration
- CORS is an explicit allowlist (`CORS_ORIGINS`); credentials mode requires reflecting the matched origin, never `*`.
- `trustProxy: true` is set on Fastify because `serve.cjs` sits in front; this is guarded by the design that the API is only reachable internally behind the SPA proxy.
- `ajv` is configured with `removeAdditional: false` so unknown request body keys are rejected (prevents silent field-name typos from being ignored).
- Session cookies default to `lax` SameSite (works across sibling subdomains like `yt.` → `api.`) and `secure` in production.
- Health endpoint exposes `GIT_COMMIT` so operators can verify the running revision.

## Conventions and constraints

- **No config files**: there are no `.env`, `.yaml`, `.toml`, or JSON config files checked in. Secrets and per-environment values live exclusively in `process.env` (provided by Dokploy UI, Docker Compose, or a local `.env` copied from `.env.example`).
- **All env vars are documented in `.env.example`** with inline comments describing purpose, defaults, and environment-specific behavior. New configuration should follow this pattern.
- **Typed accessors required**: new settings must go through `intEnv` or `boolEnv` helpers in `server/src/config.js` rather than raw `process.env` reads, ensuring consistent coercion and defaults.
- **Defaults must be safe**: defaults must fail closed (e.g. CORS defaults to known production host in prod; push notifications disable themselves when VAPID keys are absent). Nothing may silently enable dangerous behavior when env vars are missing.
- **Boot-time flags control lifecycle**: `MIGRATE_ON_BOOT` and `SEED_ON_BOOT` gate expensive startup operations; seed code is lazily imported so it does not crash production boots when the seed fixtures are absent.
- **Compose mirrors production env shape**: `docker-compose.yml` passes the same env var names used in Dokploy (e.g. `DATABASE_URL`, `PG_POOL_MAX`, `CORS_ORIGINS`) so local dev stays aligned with production configuration semantics.
- **SPA never talks to a different origin by default**: `VITE_API_BASE_URL` is intentionally left empty so the SPA always hits its own origin, letting `serve.cjs` handle the proxy and preserving SameSite cookie semantics.