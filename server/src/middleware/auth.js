/**
 * Auth middleware for THIS pass.
 *
 * Real OAuth → session lookup is not built yet. Instead, the test/dev
 * clients authenticate by storing the user's UUID in the localStorage-
 * backed auth header `X-User-Id`. The route handler reads the user row
 * and attaches it to `request.user`.
 *
 * When `TRUST_HEADER_AUTH` is false, the middleware throws 401 unless a
 * cookie session is present (cookie-based sessions are stubbed here too
 * — see the TODO).
 *
 * Two ways to use role checks in a route:
 *
 *   1. Declarative (preferred for new routes):
 *        fastify.get('/users', {
 *          preHandler: [fastify.requireAuth, fastify.requireRole('team_leader')],
 *        }, handler)
 *
 *   2. Imperative (used inside handlers where the required role depends
 *      on runtime state — e.g. order step owners):
 *        await fastify.requireAuth(request)
 *        requireRole(request, 'team_leader')
 */

import { forbidden, unauthorized } from '../domain/errors.js'
import { config } from '../config.js'
import { getPool } from '../db/pool.js'

export async function loadUserById(id) {
  if (!id) return null
  const { rows } = await getPool().query(
    'SELECT id, name, email, role, is_active FROM users WHERE id = $1 LIMIT 1',
    [id],
  )
  return rows[0] ?? null
}

export async function attachUser(request) {
  if (!config.trustHeaderAuth) {
    // Real auth path is intentionally stubbed in this pass. Fail closed
    // when TRUST_HEADER_AUTH is off — prevents accidental prod exposure.
    unauthorized('Header auth disabled — wire OAuth before using this server')
  }
  const userId = request.headers['x-user-id']
  if (!userId) unauthorized('X-User-Id header is required')
  const user = await loadUserById(userId)
  if (!user) unauthorized('Unknown user')
  if (user.is_active === false) forbidden('Hesabınız devre dışı bırakılmış.')
  request.user = user
}

/** Convenience: assert the attached user is in `roles`. */
export function requireRole(request, ...roles) {
  if (!request.user) unauthorized()
  if (!roles.includes(request.user.role)) {
    forbidden(`Bu işlem yalnızca ${roles.join(' / ')} için.`)
  }
}

/**
 * Fastify decorators so route definitions can declare auth + role checks
 * inline via `preHandler`. Each decorator returns a preHandler function
 * (Fastify's standard shape) and re-uses the imperative helpers above so
 * behaviour stays in one place.
 */
export function registerAuthDecorators(fastify) {
  // Returns a preHandler that attaches the user (or throws 401).
  fastify.decorate('requireAuth', async function requireAuth(request) {
    await attachUser(request)
  })

  // Returns a preHandler factory that asserts the attached user's role.
  fastify.decorate('requireRole', function requireRoleDecorator(...roles) {
    return async function rolePreHandler(request) {
      await attachUser(request)
      requireRole(request, ...roles)
    }
  })

  // Returns a preHandler factory that asserts the role AND that the
  // authenticated user is active. Most routes already get this for free
  // from attachUser, but routes that load users by query (e.g. dev-login)
  // should opt in explicitly.
  fastify.decorate('requireActiveUser', async function requireActiveUser(request) {
    await attachUser(request)
    if (request.user.is_active === false) {
      forbidden('Hesabınız devre dışı bırakılmış.')
    }
  })
}
