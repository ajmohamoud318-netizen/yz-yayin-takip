# Cloudflare Fix Checklist — `api.yt.mucitkarinca.com`

> **⚠️ No longer urgent — this is now optional cleanup.**
>
> The SPA has been moved to a **same-origin `/api` proxy** (`serve.cjs`
> forwards `/api/*` to the API container over Dokploy's internal network;
> `VITE_API_BASE_URL` is empty). The browser only ever talks to
> `yt.mucitkarinca.com`, so `api.yt.mucitkarinca.com` is no longer on the
> critical path and the app works fine while its TLS stays broken.
>
> That change also fixed a bug the sslip.io workaround had introduced:
> pointing the SPA at `*.sslip.io` made the API call cross-site, so the
> browser refused to store or send the `SameSite=lax` session cookie and
> every `GET /api/auth/me` returned 401. See DEPLOY.md § SPA.
>
> Work this checklist only if you want `api.yt.mucitkarinca.com` reachable
> for direct API access (curl, webhooks, a future separate client). Do
> **not** repoint `VITE_API_BASE_URL` at it afterwards — same-origin is
> now the intended configuration.

Restore canonical TLS for the API hostname so it can be used for direct
API access.

**Symptom:** Browser → `https://api.yt.mucitkarinca.com` fails with
`SSL alert 40 / handshake_failure` at the Cloudflare edge. On macOS
LibreSSL you may instead see `tlsv1 alert protocol version`
(SSL alert 112) — same root cause, just a more specific CF edge policy
saying "your TLS version isn't acceptable."

**Smell test that DNS is already fine:** `dig +short api.yt.mucitkarinca.com`
returns Cloudflare IPs (`172.67.*` / `104.21.*` / `2606:4700:3035::/48`) —
the orange cloud proxy is on. So the bug is almost certainly **TLS policy
at the edge**, not DNS.
**Why it matters:** Until this is repaired, `VITE_API_BASE_URL` in
[`.env`](.env) has to stay pointed at the sslip.io hostname — see
[DEPLOY.md §SPA](DEPLOY.md).

> A wildcard `*.mucitkarinca.com` cert is already provisioned (the
> `serve.cjs` proxy comment confirms it). So TLS at the edge is not the
> cert problem — it's almost always one of: DNS not proxied, SSL mode
> mismatch, or origin unreachable. Work the probes first, then fix only
> what breaks.

---

## 0 · Pre-flight — collect the facts (2 min)

Run these from a terminal before touching the dashboard. Save the output —
it tells you which step below actually fixes it.

```bash
# 0.1 — What CF says about the cert chain for api.yt
curl -svI --resolve api.yt.mucitkarinca.com:443:<CF_IP> \
     https://api.yt.mucitkarinca.com/ 2>&1 | grep -E 'subject|issuer|SSL|alert'

# 0.2 — Where api.yt currently resolves (proxied? cloudflare IPs?)
dig +short api.yt.mucitkarinca.com
dig +short api.yt.mucitkarinca.com A @1.1.1.1

# 0.3 — Direct hit to the Dokploy host (bypasses CF, confirms origin TLS works)
curl -svI https://yayin-takip-backend-4dvoqr-53441c-46-62-170-64.sslip.io/api/health 2>&1 | head -20
```

| Probe result | Go to |
|---|---|
| 0.1 returns SSL alert during handshake | **Step 1 + Step 2 + Step 2a (TLS minimum)** |
| 0.2 doesn't return a `104.16.x` / `172.64.x` IP (CF range) | **Step 1** |
| 0.3 fails (origin cert / port) | **Step 3** |

---

## 1 · DNS record for `api.yt.mucitkarinca.com` (Cloudflare dashboard)

**Path:** Cloudflare → `mucitkarinca.com` → **DNS** → **Records**

1. Add (or edit) a record:

   | Type | Name | Target | Proxy status |
   |---|---|---|---|
   | `CNAME` | `api.yt` | `<yz-api service host from Dokploy>` | **Proxied** (orange cloud ON) |

   > If Dokploy gave you only an IP, use an `A` record instead of `CNAME`,
   > and **still leave the proxy orange**. Without the proxy Cloudflare won't
   > terminate TLS for the hostname and you'll get exactly the alert 40 we
   > see today.
2. Ensure **no conflicting records** exist (e.g. an `A` plus a `CNAME` at the
   same name — kill the loser).
3. Click **Save**. DNS propagation is usually <60 s with CF; CF's own
   authoritative answer (`dig @1.1.1.1`) should now return CF IPs.

---

## 2 · SSL/TLS mode on the hostname (Cloudflare dashboard)

**Path:** Cloudflare → `mucitkarinca.com` → **SSL/TLS** → **Overview**

1. Set **Encryption mode = Full (Strict)**.
   - *Not* **Flexible** — Flexible would re-encrypt between CF and origin over
     plain HTTP, but Dokploy serves HTTPS only, so the visitor would hit
     `ERR_TOO_MANY_REDIRECTS`.
   - *Not* **Full** — that allows any cert on the origin and silently masks
     real origin-cert issues.
2. **Edge Certificates →** confirm `api.yt.mucitkarinca.com` shows up in the
   list. If it does **not**, click **Order** (it's free, issued by Let's
   Encrypt via CF). It should appear within a few minutes.
3. Under **SSL/TLS → Edge Certificates → Minimum TLS Version**, leave
   `TLS 1.2` (default is fine).
4. If you ever turned on **Authenticated Origin Pulls**, make sure the
   backend doesn't require the cert (Dokploy's default doesn't).

---

## 2a · Edge cipher/curve profile (most likely cause for macOS LibreSSL 3.3.6)

> **Note (2026-07-21):** Step 2a was previously written as "drop Minimum TLS
> Version to 1.2." That was wrong. The actual culprit is the **cipher/curve
> profile** at the edge, not the TLS version. The Node 20 / browser path is
> not affected — only the macOS `/usr/bin/curl` (LibreSSL 3.3.6) and any
> legacy OpenSSL client.

**Path:** Cloudflare → `mucitkarinca.com` → **SSL/TLS → Edge Certificates**

1. Look for **TLS 1.3 / TLS Version Profile** (also surfaced under
   **Settings → Compatibility → Cipher suites / TLS 1.3 Profile** on newer
   accounts). Default is sometimes **"Modern"**, which requires P-256 +
   X25519 curves. LibreSSL 3.3.6 on macOS only reliably offers X25519 and
   the modern profile rejects it with alert 40.
2. Set it to **`Intermediate`** (recommended). Still TLS 1.2 / 1.3,
   accepts the curves LibreSSL offers.
3. Leave **Minimum TLS Version = TLS 1.3** (no need to drop it; 1.3 is fine
   for all our actual clients — browsers, Node 20, Axios).
4. Confirm no **Custom TLS Profile** is bound to `api.yt.*`. Delete any
   that are.
5. Wait ~30 s, then re-test from the browser on `https://yt.mucitkarinca.com`
   first; the macOS `curl` probe is unreliable (it doesn't speak `--http1.1`
   / `--tlsv1.3` as flags).

---

## 3 · Origin reachable + cert valid (Dokploy side)

Even with correct DNS + Full Strict, handshake fails if the origin you
proxied to is wrong or its own cert has expired.

**Path:** Dokploy → project `Yayin Takip` → `yz-api` service

1. Confirm the service is **healthy**: container status = running,
   `Logs` shows the Fastify boot line (`YZ server` is your grep).
2. Confirm the **exposed port** is `4000` and matches the target you used in
   the DNS record above.
3. Visit **Domains** on the service:
   - Either keep `api.yt.mucitkarinca.com` as a service-attached domain
     *and* mirror that hostname in the DNS record from Step 1 — **or** —
     remove the Dokploy-side domain and let Cloudflare be the only
     front-door. The simplest path: **let Cloudflare handle TLS termination
     and proxy straight to the Dokploy container port.**

   When CF proxies in front, the origin can stay on its existing
   `*.sslip.io` (Let's Encrypt) cert — `Full (Strict)` accepts any
   publicly-trusted cert at the origin. So you usually don't need a
   Dokploy-provisioned `api.yt.mucitkarinca.com` Let's Encrypt cert at all.

---

## 4 · Verify the edge handshake

From anywhere with shell access:

```bash
# Should now complete TLS and return 200 (or 404 if /unknown).
curl -svI https://api.yt.mucitkarinca.com/api/health 2>&1 | grep -E 'HTTP|subject|issuer|expire'

# Sanity: /api/health should return {"ok":true,...}
curl -s https://api.yt.mucitkarinca.com/api/health
```

Expected:

```
* subject: CN = *.mucitkarinca.com        ← wildcard CF cert
* issuer:  O = Cloudflare, Inc.
* expire date: …                          ← > 30 days out
HTTP/2 200
{"ok":true,"ts":"…"}
```

If you still see SSL alert 40 → re-check Step 2 (encryption mode) and
Step 1 (proxy status). 99% of the time the proxy cloud is still grey.

---

## 5 · Restore canonical `VITE_API_BASE_URL`

Only do this **after** Step 4 returns 200.

### 5.1 — Local `.env` / `.env.example`

```diff
- # ── TEMPORARY OVERRIDE (active 2026-07-20) ─────────────────────────
- # api.yt.mucitkarinca.com fails TLS at the CF edge (alert 40).
- # Using Dokploy's sslip.io hostname so project creation works.
- VITE_API_BASE_URL=https://yayin-takip-backend-4dvoqr-53441c-46-62-170-64.sslip.io
+ VITE_API_BASE_URL=https://api.yt.mucitkarinca.com
```

(`# ── CANONICAL ──` block above it can be removed entirely.)

### 5.2 — Dokploy SPA service environment

Edit `yz-spa` in Dokploy → **Environment** → update the same key to
`https://api.yt.mucitkarinca.com`, then **Redeploy** (not just restart — the
URL is baked in at build time by Vite).

### 5.3 — Backend CORS allowlist

In Dokploy → `yz-api` → **Environment**, confirm:

```
CORS_ORIGINS=https://yt.mucitkarinca.com
```

`sanitize-cors` in `server/src/config.js` already strips the sslip.io entry;
you can also drop it from `.env` to keep the list clean.

---

## 6 · Smoke test the full stack

| Check | Expect |
|---|---|
| `https://yt.mucitkarinca.com` loads, login renders | 200 |
| Browser DevTools → Network → first `/api/users` (after login) | 200, no CORS warning |
| `curl https://api.yt.mucitkarinca.com/api/health` | `{"ok":true,...}` |
| Create a project end-to-end as team_leader | New row in `projects`, see it in dashboard |

If CORS errors reappear, the offending origin isn't in `CORS_ORIGINS` — fix
that in `server/src/config.js` (the env-driven allowlist), then rebuild the
API container.

---

## 7 · Cleanup (optional but recommended)

1. Remove the temporary `VITE_API_BASE_URL` sslip.io entry from
   `client/src/components/UserAvatar.jsx` if it's still hard-coded there as
   a fallback — the canonical URL is now reliable, so the fallback mask can
   go.
2. Update [DEPLOY.md](DEPLOY.md) § "TEMPORARY OVERRIDE" — replace with a one-
   liner pointing at this checklist, then delete the warning block.
3. Decide whether to keep `CORS_ORIGINS` allowing the sslip.io host. If
   nobody hits the SPA via that URL anymore, drop it from the allowlist
   (smaller attack surface).

---

## Rollback

If anything regresses:

1. Flip Dokploy `yz-spa` env back to the sslip.io URL and **redeploy**.
2. The Cloudflare config (Steps 1–3) stays — it's correct config, you just
   chose not to route to it.

No data migration is involved; this is purely a host-name cut-over.

---

## Appendix · Why this happens

Cloudflare only terminates TLS for **proxied** hostnames (orange cloud).
When the `api.yt` record was first added, it likely defaulted to
**DNS-only** (grey cloud) because the registrar UI imported it as a plain
`A`/`CNAME` record with proxy off. With no proxy, the browser skips CF's
edge entirely and tries to handshake with whatever the record points at
— often a Dokploy host that hasn't been issued an `api.yt.mucitkarinca.com`
cert yet → **SSL alert 40 / handshake_failure**. Flipping the proxy on is
the fix; the wildcard cert `*.mucitkarinca.com` is already issued and
covers the name.
