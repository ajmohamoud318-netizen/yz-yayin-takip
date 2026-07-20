import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { projectRoutes } from './routes/projects.js'
import { subtaskRoutes } from './routes/subtasks.js'
import { demoRoutes } from './routes/demos.js'
import { orderRoutes } from './routes/orders.js'
import { handoverRoutes } from './routes/handovers.js'
import { config } from './config.js'
import { HttpError } from './domain/errors.js'
import { up as migrateUp } from './services/migrate.js'
import { closePool } from './db/pool.js'
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
  })

  // CORS — explicit allowlist (config.corsOrigins). Hand-rolled because the
  // SPA never sends cookies in this pass (we use a header). A future pass
  // swaps to @fastify/cors with credentials=true once cookie sessions land.
  fastify.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (origin && config.corsOrigins.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin)
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
  await fastify.register(orderRoutes, { prefix: '/api' })
  await fastify.register(handoverRoutes, { prefix: '/api' })

  // Health — used by Dokploy's container probe.
  fastify.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }))

  return fastify
}

async function main() {
  // Refuse to boot if the legacy X-User-Id flag is still set. The auth
  // path is now exclusively cookie-based; a stale env var would let
  // anyone impersonate any user with a curl header.
  if (process.env.TRUST_HEADER_AUTH && process.env.TRUST_HEADER_AUTH !== 'false') {
    throw new Error(
      'TRUST_HEADER_AUTH is no longer supported. Remove it from your env. ' +
      'Auth is now cookie-session-based.',
    )
  }
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

  const shutdown = async (sig) => {
    app.log.info({ sig }, 'shutting down')
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
