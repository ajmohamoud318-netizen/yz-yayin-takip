import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import { nanoid } from 'nanoid'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { projectRoutes } from './routes/projects.js'
import { subtaskRoutes } from './routes/subtasks.js'
import { demoRoutes } from './routes/demos.js'
import { productInfoRoutes } from './routes/product-info.js'
import { orderRoutes } from './routes/orders.js'
import { handoverRoutes } from './routes/handovers.js'
import { notificationRoutes } from './routes/notifications.js'
import { pushRoutes } from './routes/push.js'
import { eventRoutes } from './routes/events.js'
import { workLogRoutes } from './routes/work-log.js'
import { targetProjectIdeaRoutes } from './routes/target-project-ideas.js'
import { meetingRoutes } from './routes/meetings.js'
import { config } from './config.js'
import { assertSafeMailConfig } from './services/mail.js'
import { HttpError } from './domain/errors.js'
import { translateValidationErrors } from './domain/validation-messages.js'
import { up as migrateUp } from './services/migrate.js'
import { closePool } from './db/pool.js'
import {
  startNotificationMaintenance, stopNotificationMaintenance,
} from './services/notification-maintenance.js'
import { registerAuthDecorators } from './middleware/auth.js'

/**
 * Server entry point.
 *
 * Responsibilities:
 *  • Boot Fastify with CORS for the SPA dev origin.
 *  • Run any pending migrations (idempotent).
 *  • Optionally seed in dev (SEED_ON_BOOT=true).
 *  • Mount every route module under /api.
 *  • Translate HttpError → JSON response with the right status.
 *  • Graceful shutdown closes the pg pool.
 */

// API version stamped on every response as `X-API-Version`. The SPA can
// then warn (or fail) when it talks to a backend build it didn't expect —
// catching deploy mismatches, rollbacks, and partial blue/green transitions
// before users notice. Read from package.json at boot so a release bumps
// the value with no code change; appended with the short git commit so
// `docker logs` can immediately identify which revision answered.
const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'),
)
const API_VERSION = `${pkg.version}+${process.env.GIT_COMMIT?.slice(0, 7) ?? 'dev'}`

export async function buildServer() {
  const fastify = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 8 * 1024 * 1024,
    // The SPA container reverse-proxies /api/* to us (see serve.cjs), so
    // the socket address is always that container. trustProxy makes
    // Fastify derive `request.ip` from X-Forwarded-For instead — which
    // the per-IP rate limiters on /auth/login, /auth/forgot-password,
    // etc. depend on to bucket by real client rather than lumping every
    // user into one.
    //
    // ⚠️ Trade-off: a client that can reach this service DIRECTLY can now
    // spoof X-Forwarded-For and sidestep those per-IP limits. That is
    // acceptable only while the sole route in is our own proxy on the
    // internal network — so the `api.yt.mucitkarinca.com` domain should be
    // removed from the API service in Dokploy (see DEPLOY.md § API). If you
    // ever need the API publicly reachable again, put a trusted proxy in
    // front that overwrites X-Forwarded-For rather than appending to it.
    trustProxy: true,
    // Fastify 5's default ajv config strips unknown body keys silently
    // (removeAdditional: true). For a security pass we want unknown keys
    // rejected with 400 instead — that way a typo in the SPA ("stage"
    // vs "stge") shows up as a real error, not a silently-ignored field.
    ajv: { customOptions: { removeAdditional: false, useDefaults: true, coerceTypes: false } },
  })

  // Security response headers. This service returns JSON + avatar images
  // (never HTML documents), so:
  //   - contentSecurityPolicy is disabled here — CSP governs document/script
  //     loading and belongs on the SPA host (serve.cjs), not the JSON API.
  //   - crossOriginResourcePolicy is set to 'cross-origin' so the SPA on a
  //     different origin can load avatar <img> responses (the default
  //     'same-origin' would block them).
  //   - COEP is left off for the same cross-origin embedding reason.
  // Everything else (HSTS, X-Content-Type-Options: nosniff, frameguard,
  // Referrer-Policy, X-DNS-Prefetch-Control, etc.) applies with helmet's
  // secure defaults.
  await fastify.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
  })

  // Per-request correlation header. Every response carries `X-Request-Id`;
  // a user reports "the save failed at 14:32" and you can `grep req_abc`
  // in `docker logs` to see the exact request, route, and stack — without
  // asking the user for a screenshot. Trusts an incoming X-Request-Id when
  // one is present (a load balancer / proxy may already generate one and
  // we want the ID to span the whole chain), otherwise mints a fresh one.
  // `API_VERSION` is stamped on the same hook so the two response headers
  // travel together and the SPA can correlate "what backend answered me"
  // with "what request triggered it".
  fastify.addHook('onRequest', async (request, reply) => {
    const id = request.headers['x-request-id'] ?? `req_${nanoid(12)}`
    request.id = id
    reply.header('X-Request-Id', id)
    reply.header('X-API-Version', API_VERSION)
  })

  // CORS — explicit allowlist (config.corsOrigins). Credentials are enabled
  // so the browser sends the httpOnly session cookie on cross-origin XHR
  // (SPA host → API host). Note: with credentials the allowed origin MUST
  // be a specific value, never '*' — we reflect the matched allowlist entry.
  fastify.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (origin && config.corsOrigins.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin)
      reply.header('Access-Control-Allow-Credentials', 'true')
      reply.header('Vary', 'Origin')
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
      reply.header(
        'Access-Control-Allow-Headers',
        'Content-Type, X-User-Id, Authorization',
      )
      reply.header('Access-Control-Max-Age', '86400')
    }
    if (request.method === 'OPTIONS') {
      reply.code(204)
      return reply.send()
    }
  })

  // Cookie parser — makes `request.cookies` + `reply.setCookie/clearCookie`
  // available. Must be registered before routes and the auth middleware.
  await fastify.register(cookie)

  // Multipart body parser (avatar + Hedef Projeler idea image uploads).
  // Must be registered before any route module that calls `request.file()`.
  //
  // The global `bodyLimit` on the Fastify instance (8 MB) is the upper
  // bound; this is the shared plugin-level ceiling under it. Each route
  // enforces its own tighter cap during read (2 MB for avatars, 5 MB for
  // idea images — see MAX_AVATAR_BYTES / MAX_IDEA_IMAGE_BYTES) so an
  // oversized upload fails fast with a clear 400 rather than a plugin-level
  // stream error.
  await fastify.register(multipart, {
    limits: {
      fileSize: 6 * 1024 * 1024,
      files: 1,
    },
  })

  // Domain-aware error handler. Anything we throw as `HttpError` lands here
  // with the right status. Domain helpers in the client use `new Error()`
  // + `err.status = N` (no HttpError), so we accept either shape.

  // Auth + role decorators (fastify.requireAuth, fastify.requireRole(...roles))
  // — must be registered before any route module so it can use them.
  registerAuthDecorators(fastify)

  fastify.setErrorHandler((err, request, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.status)
      return { error: err.message, code: err.code }
    }
    // Fastify v5 raises FST_ERR_VALIDATION for every Ajv failure (body,
    // querystring, params, headers). The default response carries the raw
    // Ajv message ("body must NOT have additional properties",
    // "body/stage must be equal to one of the allowed values") which is
    // English and doesn't name the offending field — unreadable in a
    // Turkish toast. Translate every issue into a user-friendly message
    // and surface them under `issues` so the SPA can either show the first
    // as a toast or, later, render per-field errors inline. The original
    // `error` stays as the first message so existing clients that read
    // `response.data.error` don't change behaviour.
    if (err.code === 'FST_ERR_VALIDATION' && Array.isArray(err.validation)) {
      const issues = translateValidationErrors(err.validation, err.validationContext)
      const first = issues[0]
      // `info` not `error` — a 4xx from a known client mistake is expected
      // traffic, not a server fault. Keeps production logs from drowning
      // in 400s while still letting `docker logs | grep validation` find them.
      request.log.info({
        validationContext: err.validationContext ?? 'body',
        issues,
      }, 'request validation failed')
      reply.code(400)
      return {
        error: first.message,
        code: 'validation_failed',
        validationContext: err.validationContext ?? 'body',
        issues,
      }
    }
    const code = err.status ?? err.statusCode
    if (code && code >= 400 && code < 500) {
      reply.code(code)
      return { error: err.message, code: err.code }
    }
    request.log.error({ err }, 'unhandled error')
    reply.code(500)
    return { error: 'Beklenmeyen sunucu hatası', code: 'internal_error' }
  })

  // Routes
  await fastify.register(authRoutes, { prefix: '/api' })
  await fastify.register(userRoutes, { prefix: '/api' })
  await fastify.register(projectRoutes, { prefix: '/api' })
  await fastify.register(subtaskRoutes, { prefix: '/api' })
  await fastify.register(demoRoutes, { prefix: '/api' })
  await fastify.register(productInfoRoutes, { prefix: '/api' })
  await fastify.register(orderRoutes, { prefix: '/api' })
  await fastify.register(handoverRoutes, { prefix: '/api' })
  await fastify.register(notificationRoutes, { prefix: '/api' })
  await fastify.register(pushRoutes, { prefix: '/api' })
  await fastify.register(eventRoutes, { prefix: '/api' })
  await fastify.register(workLogRoutes, { prefix: '/api' })
  await fastify.register(targetProjectIdeaRoutes, { prefix: '/api' })
  await fastify.register(meetingRoutes, { prefix: '/api' })

  // Health — used by Dokploy's container probe AND for human-readable
  // "is this the new build?" checks. The `commit` field is sourced from
  // `GIT_COMMIT` (set by the Dockerfile's build-arg wiring) so a curl
  // against this endpoint immediately reveals which revision is live.
  fastify.get('/api/health', async () => ({
    ok: true,
    ts: new Date().toISOString(),
    commit: process.env.GIT_COMMIT ?? 'unknown',
  }))

  return fastify
}

async function main() {
  // Refuse to boot when SMTP_HOST is unset in production. The mail
  // service's console fallback (see services/mail.js) prints the
  // rendered message — which carries the opaque invitation /
  // password-reset token — to stdout. In production that lands in
  // `docker logs` for anyone with log access to read. Loud-fail here so
  // the misconfig is obvious rather than silently shipping tokens into
  // the container log stream. Same shape as the SEED_ON_BOOT guard
  // below; both boot-time refusals live together so a Dokploy deploy
  // can't accidentally skip one.
  assertSafeMailConfig()
  // Refuse to boot with SEED_ON_BOOT=true in production. The seed
  // inserts real user accounts (db/seed/users.js) with a documented
  // demo password (`123456`); one env-var drift in Dokploy and those
  // passwords ship to production. Loud-fail here so the misconfig is
  // obvious in `docker logs` rather than silently shipping a known
  // password to every user row.
  if (config.seedOnBoot && process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.error(
      '[server] SEED_ON_BOOT=true is forbidden in production ' +
      '(NODE_ENV=production). The seed inserts real user accounts with a ' +
      'documented demo password (123456). Unset SEED_ON_BOOT or run locally. ' +
      'Refusing to start.',
    )
    process.exit(1)
  }
  if (config.migrateOnBoot) {
    await migrateUp()
  }
  if (config.seedOnBoot) {
    // Dev-only reminder. The log line is once-per-boot and harmless in CI;
     // it disappears in production because the guard above exits before this.
    // eslint-disable-next-line no-console
    console.warn(
      '[server] SEED_ON_BOOT=true — inserting demo users with ' +
      'the documented demo password "123456". Dev only.',
    )
    // Lazy import: the seed runner depends on db/seed/* which the
    // production runtime image doesn't ship. Loading it only here (and
    // only when SEED_ON_BOOT=true) keeps the hot boot path free of
    // the missing-file crash the static `import` used to cause.
    try {
      const { seed: seedFn } = await import('./services/seed.js')
      await seedFn()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[server] seed runner failed (non-fatal):', err.message)
    }
  }
  const app = await buildServer()
  await app.listen({ host: config.host, port: config.port })
  app.log.info(`YZ server listening on http://${config.host}:${config.port}`)

  // Push retry + retention sweeps. Started only in the real server process
  // (not from buildServer) so tests and any future in-process consumer can
  // build an app without acquiring background timers. See
  // services/notification-maintenance.js.
  startNotificationMaintenance()

  const shutdown = async (sig) => {
    app.log.info({ sig }, 'shutting down')
    // Stop the sweeps FIRST: a redeploy is exactly when an in-flight push is
    // most likely to be dropped, and a sweep that starts here would be racing
    // the pool it is about to lose. Anything still owed stays owed and the
    // next boot's sweep delivers it — which is the whole point of the outbox.
    stopNotificationMaintenance()
    try { await app.close() } catch { /* ignore */ }
    try { await closePool() } catch { /* ignore */ }
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Make every boot failure visible to `docker logs`, even if a stray
  // promise rejects after main() has already returned.
  process.on('unhandledRejection', (reason) => {
    // eslint-disable-next-line no-console
    console.error('[server] unhandledRejection:', reason)
  })
  process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    console.error('[server] uncaughtException:', err)
    process.exit(1)
  })
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[server] boot failed:', err)
    process.exitCode = 1
  })
}
