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
  // CORS allowlist for the SPA. Comma-separated env var; falls back to a
  // dev default that matches the Vite dev server.
  corsOrigins:
    process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ??
    ['http://localhost:5173', 'http://localhost:4173'],
  // When true, the server trusts the X-User-Id header as the authenticated
  // user (this pass). When false, real OAuth/cookie session validation kicks
  // in (next pass, not built yet).
  trustHeaderAuth: boolEnv('TRUST_HEADER_AUTH', true),

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
}
