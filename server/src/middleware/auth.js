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
