# Deployment Guide — YZ Yayın Takip

Production deployment on **Dokploy** with a **GitHub → Dockerfile** pipeline.
Two apps share one monorepo: a static SPA and a Fastify API, each built
from its own committed Dockerfile.

---

## Architecture

| Layer | Tech | Where |
|---|---|---|
| Frontend | React + Vite SPA, served by `serve.cjs` (built via root `Dockerfile`) | `https://yt.mucitkarinca.com` |
| Backend  | Fastify + Node 20, pg, bcryptjs, nodemailer (built via `server/Dockerfile`) | `https://api.yt.mucitkarinca.com` |
| Database | PostgreSQL 16 (Dokploy-managed) | internal: `yz-postgres:5432` |
| Email    | Resend SMTP relay | `smtp.resend.com:587` |
| Source   | GitHub `ajmohamoud318-netizen/yz-yayin-takip`, branch `main` |

---

## Repo layout

```
yz-yayin-takip/
├── client/                    # Vite SPA
│   ├── src/
│   └── package.json
├── server/                    # Fastify API
│   ├── src/
│   ├── db/migrations/         # idempotent SQL
│   ├── db/seed/               # seed fixtures
│   ├── Dockerfile             # production image (used by Dokploy + docker compose)
│   └── .dockerignore
├── Dockerfile                 # SPA build image (root)
├── serve.cjs                  # zero-dep static + SPA fallback
├── docker-compose.yml         # local dev parity
├── .env.example               # canonical env reference
└── DEPLOY.md                  # ← this file
```

The root `package.json` declares the workspaces (`client`, `server`).
The root `package-lock.json` covers **all** workspace dependencies — keep it
committed and in sync with the workspace `package.json` files.

---

## Dokploy apps

Create **two** services from the same GitHub repo.

### 1. SPA — `yz-spa`

| Setting | Value |
|---|---|
| Source | GitHub → `yz-yayin-takip` → branch `main` |
| **Build Path** | *(empty — repo root)* |
| **Build Pack** | **Dockerfile** (uses the root `Dockerfile`) |
| **Dockerfile Path** | `Dockerfile` (relative to Build Path → `./Dockerfile`) |
| Port | `3000` |
| Domain | `yt.mucitkarinca.com` (Let's Encrypt) |
| Trigger | On Push |

> `VITE_API_BASE_URL` is wired through as a **build-time ARG** in the root
> Dockerfile (see "Build-time Arguments" in the service config). Without
> it the bundle is built with an empty API URL and the SPA can't reach
> the backend.

**Environment:**
```
VITE_API_BASE_URL=https://yayin-takip-backend-4dvoqr-53441c-46-62-170-64.sslip.io
```

> Anything prefixed `VITE_` is baked into the JS bundle at build time —
> don't put secrets here.
>
> ⚠️ **TEMPORARY OVERRIDE (active as of 2026-07-20).** The canonical URL
> `https://api.yt.mucitkarinca.com` currently fails TLS at the Cloudflare
> edge (`SSL alert 40 / handshake_failure`) — the `api.*` hostname has no
> cert/origin wiring. Until that is repaired, the SPA points at the
> Dokploy-provided sslip.io hostname so project creation works end-to-end.
> When Cloudflare is fixed for `api.*`, change `VITE_API_BASE_URL` back to
> `https://api.yt.mucitkarinca.com` and redeploy.

### 2. API — `yz-api`

| Setting | Value |
|---|---|
| Source | GitHub → same repo → branch `main` |
| **Build Path** | `/server` (lowercase — case-sensitive on Linux) |
| **Build Pack** | **Dockerfile** (uses the committed `server/Dockerfile`) |
| **Dockerfile Path** | `Dockerfile` (relative to Build Path → `server/Dockerfile`) |
| Port | `4000` |
| Domain | `api.yt.mucitkarinca.com` (Let's Encrypt) |
| Trigger | On Push |

> The Dockerfile ships with a built-in `HEALTHCHECK` against
> `GET /api/health`, so Dokploy's container probe will start passing
> within ~15 s of boot (after migrations run). No extra Dokploy-side
> healthcheck config needed.

**Environment** (paste as Key/Value pairs):
```
API_BASE_URL=https://api.yt.mucitkarinca.com
DATABASE_URL=postgres://postgres:<password>@yz-postgres:5432/yz_yayin_takip
MIGRATE_ON_BOOT=true
SEED_ON_BOOT=false
SESSION_SECRET=<openssl rand -hex 32>
CORS_ORIGINS=https://yt.mucitkarinca.com
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=<resend-api-key>
SMTP_FROM=YZ Yayın Takip <noreply@yt.mucitkarinca.com>
SMTP_SECURE=false
INVITE_BASE_URL=https://yt.mucitkarinca.com
```

> Resend API key with **Sending access** only — never Full Access.

#### Persistent volumes

The API writes one piece of state to disk: user-uploaded avatars. The
default storage path in `server/src/services/avatars.js` is
`/tmp/yz-uploads/avatars` (chosen because `/tmp` is always writable
by the non-root `node` user that the image runs as). But `/tmp` is
**ephemeral**: any Dokploy redeploy / container restart wipes it.

Mount a Dokploy named volume to make avatars survive:

| Dokploy setting (on the **yz-api** service) | Value |
|---|---|
| Volume name | `yz_uploads` |
| Mount path  | `/tmp/yz-uploads` |
| Sub-path    | *(leave empty)* |

Why `/tmp/yz-uploads` and not `/app/uploads/avatars`: the latter lives
inside the WORKDIR, which is owned by root during `COPY . .` and not
writable by UID 1000 (the user the container runs as). Mounting a
volume under `/tmp` keeps the rights intact and avoids needing a
`USER root` workaround in the Dockerfile.

`docker-compose.yml` already mirrors this with a `yzuploads` named
volume, so local dev and production behave the same.

> If you ever need to swap paths (e.g. audited persistent disk on a
> managed cluster), set `AVATAR_DIR=/your/path` on the **yz-api**
> service. The SPA always rewrites `users.avatar_url` to the right
> origin via `VITE_API_BASE_URL`, so the column is path-agnostic.

### 3. Postgres — `yz-postgres`

Create via Dokploy → **Database → PostgreSQL**:

| Setting | Value |
|---|---|
| Database name | `yz_yayin_takip` |
| Username | `postgres` |
| Password | (pick something strong) |
| Version | `16-alpine` |

After it boots, paste its **internal connection URL** into `DATABASE_URL`
of the API app.

---

## How the build works

### SPA flow

```
GitHub → clone root → docker build (root Dockerfile, two stages)
       → npm install (root, with devDeps) → npm run build (vite)
       → serve.cjs serves client/dist on :3000
```

### API flow

```
GitHub → clone /server → docker build (server/Dockerfile, two stages)
       → image runs `node src/index.js` directly on :4000
       → migrations run on boot (MIGRATE_ON_BOOT=true)
       → optional seed on first deploy (SEED_ON_BOOT=true)
       → HEALTHCHECK probes GET /api/health every 30 s
```

> The Dockerfile lives at `server/Dockerfile` and is self-contained:
> it installs from `server/package.json` + `server/package-lock.json`
> (no climb to the repo root required). The older `server/nixpacks.toml`
> has been removed now that the API ships via Dockerfile.

---

## Verifying a deploy

After a successful build, hit these URLs:

| URL | Expect |
|---|---|
| `https://yt.mucitkarinca.com` | Login page (HTML) |
| `https://api.yt.mucitkarinca.com/api/health` | `{"ok":true,"ts":"..."}` |
| Browser DevTools → Network → `/api/users` | 200 OK, no CORS errors |

---

## Gotchas

1. **Build Path is case-sensitive** — `/server` not `/Server`.
2. **Don't add a top-level `dependencies` block** to the root
   `package.json`. Workspaces only — adding stray deps there desyncs
   the lockfile and breaks `npm ci`.
3. **`npm ci` requires `package-lock.json` in sync** — after changing
   any workspace's deps, run `npm install` at the root and commit the
   regenerated lockfile.
4. **Secrets never go in the repo** — `.env` is gitignored. Real
   credentials live only in Dokploy's Environment tab.
5. **Resend domain verification is mandatory** before `SMTP_FROM` will
   deliver. Add the DKIM/SPF records they provide at your registrar.

---

## Local dev

```bash
# Postgres + API
docker compose up --build

# In another terminal, the SPA with hot reload
cd client && npm run dev
```

The SPA hits the API via Vite's `/api` proxy → `localhost:4000`.
`.env` (gitignored) holds local dev secrets.

---

## Production checklist

- [x] Dokploy Postgres created
- [x] Resend domain verified, API key scoped to Sending access
- [x] TLS issued for both hostnames
- [ ] Migrate from header-auth (`X-User-Id`) to httpOnly cookie sessions
- [ ] Redis for sessions, cache, and pub-sub notifications
- [ ] Fastify schema validation on every POST/PATCH route
- [ ] Rate limiting on auth + invite endpoints
- [ ] File uploads: type + size validation