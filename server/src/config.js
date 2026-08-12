/**
 * Runtime config for the Fastify server.
 *
 * Reads from process.env (populated by Dokploy in prod, .env locally).
 * No business logic lives here — values are consumed by index.js, the
 * pg pool, and the migrate / seed scripts.
 */

function intEnv(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

function boolEnv(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  return raw === '1' || raw.toLowerCase() === 'true'
}

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: intEnv('PORT', 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/yz_yayin_takip',
  poolMax: intEnv('PG_POOL_MAX', 10),
  // Migration runner can opt out of automatic migrations on boot — useful
  // when running multiple app instances against the same database.
  migrateOnBoot: boolEnv('MIGRATE_ON_BOOT', true),
  seedOnBoot: boolEnv('SEED_ON_BOOT', false),
  // CORS allowlist for the SPA. Comma-separated env var. Falls back to the
  // Vite dev origins in dev, and to the known production SPA origin in prod
  // — so a missing CORS_ORIGINS in production fails safe (locked to the real
  // host) rather than silently allowing localhost. Always set CORS_ORIGINS
  // explicitly in prod; this default is only a backstop.
  corsOrigins:
    process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ??
    (process.env.NODE_ENV === 'production'
      ? ['https://yt.mucitkarinca.com']
      : ['http://localhost:5173', 'http://localhost:4173']),
  // When true, the server ALSO accepts the legacy `X-User-Id` header as a
  // fallback identity (dev/test convenience). Cookie sessions are always
  // tried first. MUST be false in production so auth is cookie-only and
  // the header can't be used to impersonate a user. See SECURITY_PLAN.md P0.
  trustHeaderAuth: boolEnv('TRUST_HEADER_AUTH', true),

  // Session cookie settings. The cookie holds an opaque server-side session
  // token (see services/sessions.js) — the real replacement for header auth.
  session: {
    cookieName: process.env.SESSION_COOKIE_NAME ?? 'yz_session',
    ttlDays: intEnv('SESSION_TTL_DAYS', 7),
    // Secure (HTTPS-only) defaults on in production, off in dev so the
    // cookie is accepted over http://localhost. Override with
    // SESSION_COOKIE_SECURE if needed.
    secure: boolEnv('SESSION_COOKIE_SECURE', process.env.NODE_ENV === 'production'),
    // 'lax' works across subdomains of the same site (yt. → api.) while
    // still blocking cross-site CSRF. Override to 'strict' or 'none' per env.
    sameSite: process.env.SESSION_COOKIE_SAMESITE ?? 'lax',
    // Leave unset for a host-only cookie (recommended). Set to
    // '.mucitkarinca.com' only if you need the cookie shared across
    // sibling subdomains beyond the API host.
    domain: process.env.SESSION_COOKIE_DOMAIN?.trim() || undefined,
  },

  // SMTP for invitation emails + (future) stage notifications. If SMTP_HOST
  // is unset, the server falls back to a console transport so local dev
  // still works without a mail server.
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: intEnv('SMTP_PORT', 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'YZ Yayın Takip <noreply@yukselenzeka.com>',
    secure: boolEnv('SMTP_SECURE', false),
  },

  // Public URL the invitation email links to (the SPA). In dev we default
  // to localhost; in Dokploy set this to https://yt.mucitkarinca.com.
  inviteBaseUrl:
    process.env.INVITE_BASE_URL ??
    (process.env.NODE_ENV === 'production'
      ? 'https://yt.mucitkarinca.com'
      : 'http://localhost:5173'),

  // Rate limiter backend. 'memory' (default) is a per-process Map — correct
  // for a single container. Set RATE_LIMIT_STORE=redis to share limits across
  // instances via Redis (uses `redisUrl` below); the limiter falls back to
  // in-memory automatically if Redis is unreachable, so it never hard-fails.
  rateLimit: {
    store: (process.env.RATE_LIMIT_STORE ?? 'memory').toLowerCase(),
  },

  // Web Push (VAPID). Free, no third party: the browser's own push service
  // (FCM for Chrome/Android, Apple's for Safari/iOS) delivers the message,
  // and VAPID is just the keypair that identifies us to it.
  //
  // Generate once with:  npx web-push generate-vapid-keys
  // then set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in Dokploy. The keypair is
  // STABLE for the life of the deployment — rotating it invalidates every
  // stored subscription (all devices must re-subscribe), so treat the private
  // key like a session secret.
  //
  // If either key is missing, services/push.js disables itself and logs once.
  // The app still works: notifications keep landing in the bell feed, they
  // just don't reach a closed tab. That's the intended dev default — nobody
  // needs VAPID keys to run this locally.
  push: {
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY?.trim() ?? '',
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY?.trim() ?? '',
    // mailto: or https: URL identifying us to the push service. Apple's
    // push service REJECTS subscriptions whose VAPID subject isn't a valid
    // mailto:/https: URI, so this must be set correctly for iOS to work.
    vapidSubject: process.env.VAPID_SUBJECT?.trim() || 'mailto:noreply@yukselenzeka.com',
  },

  // Redis connection string. In Dokploy this is the internal URL of the
  // managed Redis service (e.g. redis://default:<pw>@yz-redis:6379). In
  // local dev it falls back to localhost. Leave blank to disable Redis
  // features (server still boots; cache/session helpers become no-ops).
  redisUrl: process.env.REDIS_URL?.trim() ?? 'redis://localhost:6379',
}
