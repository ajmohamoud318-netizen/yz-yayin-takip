# Deployment Guide — YZ Yayın Takip

Production deployment on **Dokploy** with a **GitHub → Dockerfile** pipeline.
Two apps share one monorepo: a static SPA and a Fastify API, each built
from its own committed Dockerfile. The app tier runs as **true blue-green**:
two full, independently-running stacks sharing one Postgres — see
"Blue-green topology" below.

---

## Architecture

| Layer | Tech | Where |
|---|---|---|
| Frontend | React + Vite SPA, served by `serve.cjs` (built via root `Dockerfile`) | `https://yt.mucitkarinca.com` |
| Backend  | Fastify + Node 20, pg, bcryptjs, nodemailer (built via `server/Dockerfile`) | internal only — no public domain |
| Database | PostgreSQL 16 (Dokploy-managed), shared by both colors | internal: `yz-postgres:5432` |
| Email    | Resend SMTP relay | `smtp.resend.com:587` |
| Source   | GitHub `ajmohamoud318-netizen/yz-yayin-takip`, branch `main` |

---

## Blue-green topology

Two paired, self-contained stacks run continuously against the **same**
Postgres:

| Color | SPA service | API service |
|---|---|---|
| blue  | `yz-spa-blue`  | `yz-api-blue`  |
| green | `yz-spa-green` | `yz-api-green` |

- Each SPA proxies `/api/*` to **its own paired API** via `API_UPSTREAM`
  (env-driven in `serve.cjs`, no code change needed to point a color at its
  pair). APIs stay domain-less/internal-only — see the "Remove the public
  domain" gotcha below, which now applies to both colors permanently, not
  just as a one-time cleanup.
- The public domain (`yt.mucitkarinca.com`) lives on whichever SPA is
  **currently live**. Deploying to the idle color and smoke-testing it does
  not affect production traffic; flipping the domain is the only action
  that does.
- **Auto-deploy is wired to green only.** `yz-spa-green` and `yz-api-green`
  are the two services with a GitHub "On Push" trigger against `main` —
  every push rebuilds and redeploys both of them automatically, regardless
  of whether green is currently live or idle. `yz-spa-blue`/`yz-api-blue`
  have no trigger; they only rebuild when you manually redeploy them in
  Dokploy. Blue is not "the other slot in a ping-pong" — it's the fixed,
  manually-controlled rollback anchor.
- Both API services point at the same `DATABASE_URL` and share the same
  `yz_uploads` named volume (mounted to **both**, not one) — an avatar
  uploaded while one color is live must be visible after a flip. Verify
  your Dokploy version supports mounting one named volume into two
  services; if it doesn't, avatars need object storage as a follow-up.
- Both APIs keep `MIGRATE_ON_BOOT=true`. This is now safe because
  `migrate.js` takes a Postgres advisory lock around the whole run — two
  containers booting near-simultaneously (routine once there are two
  independent services) can't race applying the same pending migration.
  Similarly, `notification-maintenance.js`'s push-retry sweep and cleanup
  jobs are each gated behind their own advisory lock, so only one live
  instance's tick actually does the work — both colors running the 30s
  sweep forever (not just briefly, during a cutover) would otherwise
  double push-retry load continuously.

### Migration discipline: expand/contract

Because blue and green share one Postgres and both can be serving real
traffic across a flip, schema changes must be split:

- **Expand** (additive: new nullable column, new table,
  `CREATE INDEX CONCURRENTLY`) — safe to ship normally. The other color's
  currently-running code simply ignores the new shape.
- **Contract** (drop column, rename, tighten a constraint — e.g. the kind
  of change in `901d283 fix(db): drop old stage constraint before the
  baskida backfill`) — only ship *after* both colors have run code that no
  longer needs the old shape for at least one full flip cycle. Split these
  into two releases instead of one.

### Deploy / flip / rollback runbook

Green auto-deploys on every push — there's no per-release choice of which
color to target. Blue only ever moves when you tell it to.

1. Push → `yz-spa-green`/`yz-api-green` rebuild and redeploy automatically.
2. Migrations auto-apply on green's API boot (advisory-locked, safe even
   while blue is still live and serving).
3. Smoke-test green privately: hit `yz-api-green`'s internal `/api/health`
   (returns `commit` — the built git SHA, see `src/index.js`) to confirm
   the new build is running, and load `yz-spa-green` directly via its
   Dokploy-assigned internal/preview URL.
4. **Flip** (only once green looks good): reassign `yt.mucitkarinca.com`
   from `yz-spa-blue` to `yz-spa-green` in Dokploy. If green isn't ready,
   just leave blue live — the next push re-tries green, no flip needed.
5. Monitor. Keep blue running warm, still on its last build, as an instant
   rollback (flip the domain back — no rebuild) for a defined window
   (e.g. 24–48h).
6. Once you're confident, manually redeploy `yz-spa-blue`/`yz-api-blue`
   in Dokploy (same commit as green) so blue catches up and becomes a
   fresh rollback anchor for the *next* release. Skipping this step is
   fine — it just means blue's rollback point stays older.

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

Create **four** services from the same GitHub repo — two paired stacks, per
"Blue-green topology" above. `yz-spa-blue`/`yz-api-blue` and
`yz-spa-green`/`yz-api-green` are configured identically to each other
except for the fields called out below (domain, `API_UPSTREAM`).

### 1. SPA — `yz-spa-blue` / `yz-spa-green`

| Setting | Value |
|---|---|
| Source | GitHub → `yz-yayin-takip` → branch `main` |
| **Build Path** | *(empty — repo root)* |
| **Build Pack** | **Dockerfile** (uses the root `Dockerfile`) |
| **Dockerfile Path** | `Dockerfile` (relative to Build Path → `./Dockerfile`) |
| Port | `3000` |
| Domain | `yt.mucitkarinca.com` on whichever color is **live**; the idle color gets no public domain (use Dokploy's internal/preview URL to smoke-test it) |
| Trigger | On Push, **green only** — `yz-spa-blue` has no trigger, deploy it manually |

> `VITE_API_BASE_URL` is wired through as a **build-time ARG** in the root
> Dockerfile (see "Build-time Arguments" in the service config). Without
> it the bundle is built with an empty API URL and the SPA can't reach
> the backend.

**Environment** (`yz-spa-blue` points at `yz-api-blue`, `yz-spa-green` at `yz-api-green` — never cross-wire them):
```
VITE_API_BASE_URL=
API_UPSTREAM=http://yz-api-blue:4000   # or http://yz-api-green:4000 on the green SPA
```

> Anything prefixed `VITE_` is baked into the JS bundle at build time —
> don't put secrets here.
>
> **`VITE_API_BASE_URL` must stay empty.** The SPA then calls a relative
> `/api`, and `serve.cjs` reverse-proxies `/api/*` to `API_UPSTREAM` over
> Dokploy's internal network. From the browser's point of view there is
> only ever one origin — `yt.mucitkarinca.com` — which means:
>
> - the `yz_session` cookie (httpOnly, `SameSite=lax`) is stored and sent
>   normally, because nothing is cross-site;
> - no CORS preflights, no `Access-Control-*` negotiation;
> - the `api.yt.mucitkarinca.com` edge cert is not on the critical path,
>   so the Cloudflare TLS failure in `CLOUDFLARE_FIX.md` no longer blocks
>   the app.
>
> Set `API_UPSTREAM` to the **paired** API service's slug and port as
> Dokploy resolves it internally (confirm the exact slug in the Dokploy UI —
> it must match or every `/api` call returns 502). `yz-spa-blue` →
> `yz-api-blue`, `yz-spa-green` → `yz-api-green`.
>
> ⚠️ **Historical note.** Between 2026-07-20 and this change the SPA pointed
> directly at `https://yayin-takip-backend-…sslip.io` because
> `api.yt.mucitkarinca.com` fails TLS at the Cloudflare edge (SSL alert 40).
> That worked around the TLS problem but made the SPA→API call cross-site,
> which broke cookie auth — every `GET /api/auth/me` returned 401 and no
> one could stay logged in. Don't reintroduce a cross-domain
> `VITE_API_BASE_URL` without also setting `SESSION_COOKIE_SAMESITE=none`
> and `SESSION_COOKIE_SECURE=true` on the API.

### 2. API — `yz-api-blue` / `yz-api-green`

| Setting | Value |
|---|---|
| Source | GitHub → same repo → branch `main` |
| **Build Path** | `/server` (lowercase — case-sensitive on Linux) |
| **Build Pack** | **Dockerfile** (uses the committed `server/Dockerfile`) |
| **Dockerfile Path** | `Dockerfile` (relative to Build Path → `server/Dockerfile`) |
| Port | `4000` |
| Domain | **none, on either color** — see below |
| Trigger | On Push, **green only** — `yz-api-blue` has no trigger, deploy it manually |

> **No public domain on this service — for either color, permanently.**
> Browser traffic reaches the API only through its paired SPA's `/api`
> proxy on the internal network.
>
> It has to stay off rather than merely unused, because the API runs with
> `trustProxy: true` (so it can read the real client IP out of
> `X-Forwarded-For` for the per-IP rate limiters). Anything that can reach
> the API *directly* can therefore forge that header and bypass the
> login/forgot-password throttles. Closing the public route removes the
> only way to do that. To smoke-test a color before flipping, use Dokploy's
> internal/preview URL, not a public domain.

> The Dockerfile ships with a built-in `HEALTHCHECK` against
> `GET /api/health`, so Dokploy's container probe will start passing
> within ~15 s of boot (after migrations run). No extra Dokploy-side
> healthcheck config needed.

**Environment** (paste as Key/Value pairs — **identical across `yz-api-blue`
and `yz-api-green`** except where noted):
```
API_BASE_URL=https://yt.mucitkarinca.com
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
VAPID_PUBLIC_KEY=<npx web-push generate-vapid-keys>
VAPID_PRIVATE_KEY=<npx web-push generate-vapid-keys>
VAPID_SUBJECT=mailto:noreply@yt.mucitkarinca.com
```

> `DATABASE_URL`, `SESSION_SECRET`, and the `VAPID_*` pair must be **the
> same value on both colors** — they share one Postgres, and a push
> subscription or session created while one color was live has to keep
> working after a flip to the other. Generate each of these once and paste
> the same value into both services; never regenerate independently per
> color.
>
> Resend API key with **Sending access** only — never Full Access.

#### Web push (VAPID) keys

Generate the pair **once**, locally:

```bash
npx web-push generate-vapid-keys
```

Paste both values into the API's Environment tab. Notes:

- **The keypair is permanent.** Rotating it invalidates every stored
  subscription — every user must re-enable notifications on every device,
  with no warning that they've stopped working. Treat the private key like
  `SESSION_SECRET`.
- **`VAPID_SUBJECT` must be a valid `mailto:` or `https:` URI.** Apple's push
  service rejects subscriptions outright if it isn't, so iOS silently fails
  while Android works — a confusing failure worth avoiding.
- **Omitting the keys is safe.** The server logs one warning, disables push,
  and the in-app bell keeps working. That's the intended local-dev default.
- The keys are read at first use, so changing them requires an API restart.

#### Persistent volumes

The API writes one piece of state to disk: user-uploaded avatars. The
default storage path in `server/src/services/avatars.js` is
`/app/.yz-uploads/avatars`. The Docker image uses an entrypoint
(`server/docker-entrypoint.sh`) that runs as root only long enough to
`mkdir -p` and `chown 1000:1000` the upload dir (Dokploy creates
named volumes root-owned by default) before `exec`-ing the Fastify
process as the unprivileged `node` user — so the runtime itself never
has root, but persistent volumes still become writable without
operator intervention.

Mount a Dokploy named volume at `/app/.yz-uploads` so avatars survive
every redeploy:

| Dokploy setting (on **both** `yz-api-blue` and `yz-api-green`) | Value |
|---|---|
| Volume name | `yz_uploads` (the **same** volume, mounted into both services) |
| Mount path  | `/app/.yz-uploads` |
| Sub-path    | *(leave empty)* |

> Mount the **same** volume into both API services, not one per color — an
> avatar uploaded while blue is live must still be there after flipping to
> green. Confirm your Dokploy version actually supports mounting one named
> volume into two services simultaneously before relying on this; if it
> doesn't, avatars need object storage instead.

Why `/app/.yz-uploads` and not `/tmp/yz-uploads` (the old default):
`/tmp` is **ephemeral** — any Dokploy redeploy / container restart
wipes it, which is why earlier avatar uploads always disappeared on
deploy. `/app` is the WORKDIR, and the entrypoint ensures its subdirs
are owned by UID 1000 (the user the container runs as), so a mounted
named volume at this path is both persistent and writable.

`docker-compose.yml` mirrors this with a `yzuploads` named volume
mounted at the same path, so local dev and production behave the
same.

> If you ever need to swap paths (e.g. audited persistent disk on a
> managed cluster), set `AVATAR_DIR=/your/path` on **both** `yz-api-blue`
> and `yz-api-green`. The SPA always rewrites `users.avatar_url` to the
> right origin via `VITE_API_BASE_URL`, so the column is path-agnostic.

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

Before flipping the domain, smoke-test the idle color on its internal/
preview URL (Dokploy assigns one to every service, domain or not):

| Check | Expect |
|---|---|
| idle SPA's preview URL | Login page (HTML) |
| idle API's internal `/api/health` | `{"ok":true,"ts":"...","commit":"<the SHA you just pushed>"}` |
| idle SPA preview → DevTools → Network → `/api/users` | 200 OK, no CORS errors |

After flipping `yt.mucitkarinca.com` to the new color, re-check the public
URLs:

| URL | Expect |
|---|---|
| `https://yt.mucitkarinca.com` | Login page (HTML) |
| `https://yt.mucitkarinca.com/api/health` (proxied) | `{"ok":true,"ts":"...","commit":"<the SHA you just pushed>"}` |
| Browser DevTools → Network → `/api/users` | 200 OK, no CORS errors |
| `https://yt.mucitkarinca.com/manifest.webmanifest` | JSON, `Content-Type: application/manifest+json` |
| `https://yt.mucitkarinca.com/sw.js` | JS, `Cache-Control: no-cache` |

If anything looks wrong, flip the domain back to the previous color — no
rebuild needed, it's still running.

### Verifying web push

Push fails silently at half a dozen layers, so verify on a **real device** —
emulators and desktop DevTools do not reproduce mobile push behaviour.

1. Open the site, sign in, click the bell → **"Telefona/bilgisayara bildirim
   gönder"**. Accept the permission prompt. A test push fires automatically;
   if it doesn't arrive, the toast says so.
2. On **iOS**: the bell shows install instructions instead of a toggle until
   the app is added to the Home Screen. Add it, reopen from the Home Screen
   icon (not Safari), then enable. iOS 16.4+ required.
3. On **Android**: works in a normal Chrome tab; installing is optional.
4. Close the app entirely, have someone trigger a real event (a demo or
   ozalit request to matbaa), and confirm the notification arrives and that
   tapping it opens the right project.
5. `POST /api/push/test` returns `{ sent, pruned }` — `sent: 0` means no
   device is registered for that user, which distinguishes "subscription
   missing" from "OS suppressed the notification".

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
6. **Never cross-wire a color's `API_UPSTREAM`.** `yz-spa-blue` must only
   ever point at `yz-api-blue`, and green likewise — pointing both SPAs at
   the same API defeats the whole point of testing a color in isolation
   before flipping.
7. **`DATABASE_URL`, `SESSION_SECRET`, and `VAPID_*` must be identical
   across both API colors.** They share one Postgres and one set of push
   subscriptions; diverging these breaks sessions or push after a flip.
8. **Contract migrations (drop/rename/tighten) need two releases, not
   one** — see "Migration discipline" above. Shipping a contract change in
   the same release as the code that stops needing the old shape breaks
   whichever color is still running the old code.

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
- [x] `migrate.js` advisory-locked against concurrent blue/green boots
- [x] Notification sweep/cleanup advisory-locked so only the lock-winning
      color does the work each tick
- [ ] `yz-spa-green` / `yz-api-green` services created in Dokploy (today
      only blue exists, renamed from the original `yz-spa`/`yz-api`)
- [ ] Confirm Dokploy supports mounting `yz_uploads` into two services at
      once; otherwise plan avatar object storage
- [ ] Rehearse one full flip (deploy green, smoke-test, flip domain, flip
      back) before relying on it for a real release
- [ ] Migrate from header-auth (`X-User-Id`) to httpOnly cookie sessions
- [ ] Redis for sessions, cache, and pub-sub notifications
- [ ] Fastify schema validation on every POST/PATCH route
- [ ] Rate limiting on auth + invite endpoints
- [ ] File uploads: type + size validation