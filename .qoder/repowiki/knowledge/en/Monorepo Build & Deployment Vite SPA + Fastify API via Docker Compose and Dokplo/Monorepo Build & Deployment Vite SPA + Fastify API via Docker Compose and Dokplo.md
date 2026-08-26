---
kind: build_system
name: 'Monorepo Build & Deployment: Vite SPA + Fastify API via Docker Compose and Dokploy'
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - client/package.json
    - server/package.json
    - Dockerfile
    - server/Dockerfile
    - server/docker-entrypoint.sh
    - docker-compose.yml
    - serve.cjs
    - client/vite.config.js
    - client/vitest.config.js
    - server/src/services/migrate.js
    - .env.example
---

## What system/approach is used

This repository is an npm workspaces monorepo (`package.json` at the root declares `workspaces: ["client", "server"]`) that builds two separate Node.js services — a Vite-based React SPA in `client/` and a Fastify API server in `server/` — into independent Docker images. Development uses `docker-compose.yml` to run PostgreSQL, the Fastify server (with auto-migrate + seed), and the Vite dev server together. Production deploys the SPA as a static site served by a zero-dependency `serve.cjs` shim and the API as its own Dokploy application.

## Key files and packages

- **Root orchestration**: `package.json` (npm workspaces, top-level scripts like `build`, `test`, `migrate`, `seed`, `server:start`); `docker-compose.yml` (dev stack with postgres/server/client).
- **Client build**: `client/package.json` (Vite/Vitest/Tailwind scripts); `client/vite.config.js`; `client/vitest.config.js`; `client/postcss.config.js`; `client/tailwind.config.js`.
- **Server build**: `server/package.json` (Fastify runtime, `node --watch src/index.js` for dev, `node --test` for tests); `server/Dockerfile` (two-stage alpine image, production-only deps, healthcheck against `/api/health`); `server/docker-entrypoint.sh` (creates/chowns upload dir, drops to unprivileged `node` user via `gosu`).
- **Production SPA server**: `serve.cjs` — a single-file Node HTTP server that serves `client/dist`, proxies `/api/*` to the backend upstream (`API_UPSTREAM`, default `http://backend:4000`), handles SPA history fallback, and sets cache headers per asset type.
- **Root production image**: `Dockerfile` — two-stage build: Stage 1 installs workspace deps (including devDeps so rollup is available) and runs `vite build` producing `client/dist`; Stage 2 copies only `client/dist` + `serve.cjs` onto a minimal `node:20-alpine` runtime.
- **Database migrations**: `server/db/migrations/*.sql` (numbered `001__...` through `054__...`), applied via `server/src/services/migrate.js` (invoked by `npm run migrate` and on boot when `MIGRATE_ON_BOOT=true`).
- **Environment**: `.env.example` at repo root; compose reads it for the server container.

## Architecture and conventions

### Two-stage Docker builds
Both the root SPA image and `server/Dockerfile` use multi-stage builds. The build stage installs all dependencies (including devDeps for the client's Vite build) and produces artifacts; the runtime stage copies only what's needed. This keeps production images small and reproducible.

### Environment variable scoping for builds vs runtime
The root `Dockerfile` explicitly sets `ENV NODE_ENV=development` during install so npm includes devDeps, then overrides `NODE_ENV=production` only on the `npm run build` command line. The comment explains that Vite inlines `process.env.NODE_ENV` into the bundle from the build-time value, so leaving it unset or setting it to development would ship React's development build (~280 kB extra JS). Similarly, `VITE_API_BASE_URL` is passed as a build ARG so it can be embedded into the SPA at build time when the backend lives on a different host.

### Zero-dependency SPA runtime
The production SPA image does not install any Node modules at runtime. `serve.cjs` uses only built-in `http`, `fs`, `path`, and `util` modules. It serves hashed assets with long cache headers, never caches `index.html` or `sw.js`, and reverse-proxies `/api/*` to the backend service. Path traversal is guarded via `safeJoin` before serving files.

### Unprivileged runtime with privileged entrypoint
The server image runs its entrypoint as root (needed to chown Dokploy-mounted volumes created as `root:0`), then uses `gosu node:node` to exec the Fastify process as the non-root `node` user (UID 1000). The actual server process never runs as root.

### Dev parity with production
`docker-compose.yml` mirrors the production topology locally: postgres on port 5432, server on 4000, client Vite dev server on 5173 with `/api` proxied to the server. Persistent named volumes (`pgdata`, `yzuploads`) keep database state and uploaded avatars across `docker compose down`.

### Migration and seeding
Migrations are SQL files under `server/db/migrations/` numbered sequentially. They are applied programmatically via `server/src/services/migrate.js up` (run via `npm run migrate` or automatically on boot when `MIGRATE_ON_BOOT=true`). Seed data lives under `server/db/seed/` and is invoked via `npm run seed`.

### Testing
- Client: Vitest (`npm test` / `npm run test:domain` / `npm run test:coverage`), configured in `client/vitest.config.js`.
- Server: Node's built-in `--test` runner (`node --test "src/**/*.test.js"`), invoked via `npm run test` or `npm run test:server` from the root workspace.

### Versioning and provenance
The server Dockerfile accepts a `GIT_COMMIT` build arg and exposes it via `GET /api/health`, so a running container reports which commit it was built from. No semantic versioning automation is present beyond the `version` fields in each `package.json`.

## Conventions and constraints

- **Workspace-first scripting**: All top-level commands (`build`, `test`, `migrate`, `seed`, `server:start`) delegate to `npm --workspace <name> run ...`. New tasks should follow this pattern rather than calling sub-package scripts directly.
- **Node 20 requirement**: Both `server/package.json` engines field and both Dockerfiles pin `node:20-alpine`; new tooling must support Node ≥20.
- **Ecosystem module mode**: Both `client/package.json` and `server/package.json` declare `"type": "module"`; imports must use ESM syntax.
- **No CI pipeline in repo**: There is no GitHub Actions/GitLab CI configuration in the tree. The root `Dockerfile` comments indicate deployment is done via Dokploy using Dockerfile builds, and the server `Dockerfile` is similarly Dokploy-targeted.
- **Lockfile usage**: The server image prefers `npm ci --omit=dev` with a lockfile fallback to `npm install`; the root build intentionally uses `npm install --no-audit --no-fund --include=dev` (not `ci`) because of a known issue where `npm ci` drops platform-specific rollup binaries in workspaces.
- **Upload storage path**: The avatar upload directory defaults to `/app/.yz-uploads/avatars` (configurable via `AVATAR_DIR`), owned by UID 1000:1000 with mode `0o770`. This path is mounted as a named volume in compose and expected to be persisted in Dokploy.
- **Health endpoint**: The server exposes `GET /api/health` (used by the container `HEALTHCHECK` and by Dokploy probes); adding new endpoints should not break this probe.
- **CORS for dev**: The compose server sets `CORS_ORIGINS=http://localhost:5173` to allow the Vite dev server to call the API; production deployments configure CORS separately.