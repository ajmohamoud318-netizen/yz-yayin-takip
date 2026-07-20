# Deployment Guide — YZ Yayın Takip

Production deployment on **Dokploy** with a **GitHub → Nixpacks** pipeline.
Two apps share one monorepo: a static SPA and a Fastify API.

---

## Architecture

| Layer | Tech | Where |
|---|---|---|
| Frontend | React + Vite SPA, served by `serve.cjs` | `https://yt.mucitkarinca.com` |
| Backend  | Fastify + Node 20, pg, bcryptjs, nodemailer | `https://api.yt.mucitkarinca.com` |
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
│   ├── Dockerfile
│   └── nixpacks.toml          # build config (read by Dokploy)
├── nixpacks.toml              # SPA build config
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
| Build Pack | Nixpacks (auto-detected via root `nixpacks.toml`) |
| Port | `3000` |
| Domain | `yt.mucitkarinca.com` (Let's Encrypt) |
| Trigger | On Push |

**Environment:**
```
VITE_API_BASE_URL=https://api.yt.mucitkarinca.com
VITE_USE_MOCK=false
```

> `VITE_USE_MOCK` must be `false` for the SPA to talk to the real backend.
> Anything prefixed `VITE_` is baked into the JS bundle at build time —
> don't put secrets here.

### 2. API — `yz-api`

| Setting | Value |
|---|---|
| Source | GitHub → same repo → branch `main` |
| **Build Path** | `/server` (lowercase — case-sensitive on Linux) |
| Build Pack | Nixpacks |
| Port | `4000` |
| Domain | `api.yt.mucitkarinca.com` (Let's Encrypt) |
| Trigger | On Push |

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
GitHub → clone root → npm ci (root installs all workspaces)
       → npm run build (runs `vite build` in client/)
       → serve.cjs serves client/dist on :3000
```

### API flow

```
GitHub → clone /server → cd .. && npm ci (climbs to root for lockfile)
       → npm start → node src/index.js (Fastify on :4000)
       → migrations run on boot (MIGRATE_ON_BOOT=true)
       → optional seed on first deploy (SEED_ON_BOOT=true)
```

> The `cd .. && npm ci` in `server/nixpacks.toml` is intentional: the
> root `package-lock.json` is the source of truth for all workspace deps.

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