/**
 * Auth middleware — magic-link cookie session edition.
 *
 * The previous pass trusted the `X-User-Id` header as the authenticated
 * identity. That gap is now closed: every request must carry a signed
 * session cookie, and we look up the user from Postgres using the user
 * id stored in the session.
 *
 * Flow:
 *   1. POST /api/auth/magic               — user enters email → email sent
 *   2. GET  /api/auth/magic/callback      — token consumed → session created
 *                                            → Set-Cookie → 302 to SPA
 *   3. All subsequent requests carry the yz_sid cookie. We parse it,
 *      look up the session in Redis, then load the user from Postgres
 *      so role + is_active + avatar are fresh.
 *
 * Dev escape hatch: `POST /api/auth/dev-login` is gated by NODE_ENV so
 * local dev never needs to round-trip through email.
 */

import { forbidden, unauthorized } from '../domain/errors.js'
import { getPool } from '../db/pool.js'
import { parseSessionCookie } from '../services/cookies.js'
import { getSession } from '../services/sessions.js'

export async function loadUserById(id) {
  if (!id) return null
  const { rows } = await getPool().query(
    `SELECT id, name, email, role, is_active, can_approve_ozalit,
            avatar_url, avatar_updated_at
     FROM users WHERE id = $1 LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

/**
 * Attach the current user from the session cookie. Throws 401 on any
 * failure (no cookie, bad signature, expired session, missing user,
 * deactivated user). Use via `await attachUser(request)` or via the
 * `fastify.requireAuth` decorator.
 */
export async function attachUser(request) {
  const cookieHeader = request.headers.cookie
  const cookie = parseSessionCookie(cookieHeader)
  if (!cookie) unauthorized('Oturum açmanız gerekiyor.')
  const session = await getSession(cookie.sid)
  if (!session) unauthorized('Oturum süresi dolmuş.')
  const user = await loadUserById(session.userId)
  if (!user) {
    // User was deleted while their session was live. The session row
    // becomes stale; we let the next call GC it via TTL.
    unauthorized('Kullanıcı bulunamadı.')
  }
  if (user.is_active === false) forbidden('Hesabınız devre dışı bırakılmış.')
  request.user = user
  request.session = { sid: cookie.sid, ...session }
}

/** Convenience: assert the attached user is in `roles`. */
export function requireRole(request, ...roles) {
  if (!request.user) unauthorized()
  if (!roles.includes(request.user.role)) {
    forbidden(`Bu işlem yalnızca ${roles.join(' / ')} için.`)
  }
}

/**
 * Fastify decorators for declarative auth + role checks.
 *
 * Usage:
 *   fastify.get('/users', {
 *     preHandler: [fastify.requireAuth, fastify.requireRole('team_leader')],
 *   }, handler)
 */
export function registerAuthDecorators(fastify) {
  fastify.decorate('requireAuth', async function requireAuth(request) {
    await attachUser(request)
  })

  fastify.decorate('requireRole', function requireRoleDecorator(...roles) {
    return async function rolePreHandler(request) {
      await attachUser(request)
      requireRole(request, ...roles)
    }
  })

  fastify.decorate('requireActiveUser', async function requireActiveUser(request) {
    await attachUser(request)
    if (request.user.is_active === false) {
      forbidden('Hesabınız devre dışı bırakılmış.')
    }
  })
}
