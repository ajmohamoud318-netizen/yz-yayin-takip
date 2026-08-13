import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
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
import { workLogRoutes } from './routes/work-log.js'
import { config } from './config.js'
import { HttpError } from './domain/errors.js'
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

  // Multipart body parser (avatar uploads). Must be registered before
  // any route module that calls `request.file()`.
  //
  // The global `bodyLimit` on the Fastify instance (8 MB) is the upper
  // bound; the avatar route enforces a tighter 2 MB cap during read
  // so an oversized upload fails fast with a clear 400.
  await fastify.register(multipart, {
    limits: {
      fileSize: 2 * 1024 * 1024,
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
  await fastify.register(workLogRoutes, { prefix: '/api' })

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
  if (config.migrateOnBoot) {
    await migrateUp()
  }
  if (config.seedOnBoot) {
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
