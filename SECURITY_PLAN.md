# Security Hardening Plan — YZ Yayın Takip

> **Status (2026-07-27): P0–P3 all implemented.** Remaining action is
> operational — set the production env vars listed under "Deploy switches"
> below. See each section's ✅ notes.
>
> ### Deploy switches (must set in production)
> - `TRUST_HEADER_AUTH=false` — makes auth cookie-only (closes the P0 hole).
> - `NODE_ENV=production` — enables `secure` cookies, disables `dev-login`.
> - `CORS_ORIGINS=https://yt.mucitkarinca.com` — explicit SPA origin.
> - (optional) `RATE_LIMIT_STORE=redis` + `REDIS_URL=...` — only if you run
>   more than one app instance; falls back to in-memory if Redis is down.


> Grounded in the current `server/` code as of 2026-07-27, not the generic
> checklist. Several items from AGENTS.md's Production Checklist are already
> done (rate limiting, schema validation, account-enumeration protection,
> upload size/MIME caps) — this plan covers what's actually still open.
> Work top-to-bottom: P0 is the only item that matters until it's done.

## What's already in place (don't redo)

- **Passwords**: bcrypt hashing (`auth.js`), cost 10.
- **Login rate limiting**: per-IP + per-email buckets on `/auth/login`,
  `/auth/accept-invite`, `/auth/reset-password`, `/auth/forgot-password`
  (`middleware/rate-limit.js`).
- **Account-enumeration protection**: `/auth/forgot-password` always returns 200.
- **Invite/reset tokens**: `nanoid(32)`, single-use, TTL (7d invite / 1h reset),
  invalidated on use (`invitations.js`, `password-resets.js`).
- **Schema validation**: present on nearly every POST/PATCH (only notifications gap).
- **Uploads**: 2 MB / 1-file cap + MIME allowlist on avatars.
- **Body handling**: `removeAdditional:false` so unknown keys 400 instead of silently dropping.
- **dev-login**: disabled when `NODE_ENV=production`.

---

## P0 — Replace the `X-User-Id` trusted header  ⚠️ blocks everything

**The hole.** `attachUser` (`middleware/auth.js`) trusts whatever `X-User-Id`
the client sends, and `/auth/login` returns `token: user.id` — a plain,
non-secret identifier. Anyone can send `X-User-Id: u-ayse` and become the team
leader. Every `requireRole` check is unenforceable until this changes.

**The fix (sessions first, OAuth later).** Sessions and OAuth are separate;
you get the full security benefit from sessions alone while keeping the
existing bcrypt password login.

1. On successful login, mint a random session id, store it server-side
   (Redis — `redisUrl` already in config — or a `sessions` table) mapping
   session → user id + expiry.
2. Return it in an `httpOnly`, `secure`, `sameSite=strict` cookie. Client JS
   can't read or forge it.
3. Rewrite `attachUser` to read the session cookie, look it up in the store,
   and resolve the user from there. Missing/invalid → 401.
4. `/auth/logout` deletes the session (currently a no-op).
5. Client `client.js`: set `withCredentials:true`, remove the `X-User-Id`
   interceptor and the `localStorage` token logic; update the 401-cleanup path.
6. Keep `dev-login` gated by `NODE_ENV`.

**Definition of done.** Forging identity is impossible from the browser or curl;
logout actually invalidates; role gates are real.

---

## P1 — Security response headers (helmet)

None are sent today. Register `@fastify/helmet` in `index.js` for CSP, HSTS,
X-Frame-Options, X-Content-Type-Options, Referrer-Policy. One line, then tune
the CSP so the SPA's assets still load. Independent of P0 — can ship first.

## P1 — Harden CORS for cookie auth

`index.js` reflects an allowlisted origin (good) but allows the `X-User-Id`
header and runs without credentials. When P0 lands: switch to
`credentials:true`, drop the `X-User-Id` allowed header, and set `CORS_ORIGINS`
to the real domain in prod (the current default is localhost). Credentialed
CORS can't use a wildcard origin — **must land with P0.**

---

## P2 — Rate limiter → Redis + cover invite route

`middleware/rate-limit.js` is an in-memory `Map` — correct for one container,
but limits reset per-instance and don't hold across a multi-instance deploy.
Back it with Redis. Also add a bucket to `POST /users/invite`, which is
currently unthrottled (a compromised leader session could spam invites/email).

## P2 — Validate `:id` params on notification routes

`notifications.js` has two handlers with no JSON schema
(`/notifications/:id/read`, `/notifications/read-all`). Add param validation
for the `:id` route to close the one gap in otherwise complete schema coverage.

---

## P3 — Defense-in-depth pass

- Bump bcrypt cost 10 → 12 (re-hash on next login is optional).
- Add a magic-byte check on avatar uploads (MIME header alone is spoofable).
- Confirm `.env` is gitignored; keep `DATABASE_URL` / `SMTP_PASS` env-only.
- In prod set `TRUST_HEADER_AUTH=false` + `NODE_ENV=production` so header auth
  fails closed once sessions are the real path.
- Don't log full invite/reset URLs outside dev (the dev mail transport logs
  them to console — fine locally, ensure that path can't run in prod).

---

## Suggested order

1. **P0** (sessions) — do this before anything else; it's the actual risk.
2. **P1 helmet** in parallel (independent, quick win).
3. **P1 CORS** alongside P0.
4. **P2** rate-limiter-to-Redis + invite bucket, then notification schemas.
5. **P3** hardening sweep last.
