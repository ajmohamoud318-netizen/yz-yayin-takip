/**
 * Session service.
 *
 * Owns the lifecycle of a server-side session — the real replacement for
 * the trusted `X-User-Id` header (SECURITY_PLAN.md P0):
 *
 *   1. `createSession({ userId })`  — mints an opaque token, inserts a row
 *      in `sessions`, returns { token, expiresAt }.
 *   2. `getSessionUser(token)`      — returns the joined user if the token
 *      is active (exists + not expired + user active); else null.
 *   3. `deleteSession(token)`       — logout: invalidates one session.
 *   4. `deleteUserSessions(userId)` — invalidate every session for a user
 *      (e.g. on deactivate / password change).
 *
 * The token is minted with nanoid(48) → ~285 bits of entropy, so it is
 * not guessable and never needs to be signed (it's a random lookup key,
 * not a claims blob). It lives only in an httpOnly cookie.
 *
 * Cookie options are centralised in `sessionCookieOptions()` so the login,
 * dev-login, accept-invite, reset-password, and logout routes all set /
 * clear the cookie identically.
 */

import { nanoid } from 'nanoid'
import { getPool } from '../db/pool.js'
import { config } from '../config.js'

export async function createSession({ userId }) {
  const token = nanoid(48)
  const { rows } = await getPool().query(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' days')::INTERVAL)
     RETURNING token, expires_at`,
    [token, userId, String(config.session.ttlDays)],
  )
  return { token: rows[0].token, expiresAt: rows[0].expires_at }
}

/**
 * Resolve the user behind an active session token, or null. The
 * `expires_at > NOW()` predicate means expired rows are ignored even if a
 * sweep hasn't deleted them yet. Shape matches `loadUserById` so callers
 * can attach it to `request.user` unchanged.
 */
export async function getSessionUser(token) {
  if (!token) return null
  const { rows } = await getPool().query(
    `SELECT u.id, u.name, u.email, u.role, u.is_active,
            u.avatar_url, u.avatar_updated_at,
            CASE WHEN u.daily_status_date = CURRENT_DATE THEN u.daily_status END AS daily_status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = $1
        AND s.expires_at > NOW()
      LIMIT 1`,
    [token],
  )
  return rows[0] ?? null
}

export async function deleteSession(token) {
  if (!token) return
  await getPool().query(`DELETE FROM sessions WHERE token = $1`, [token])
}

export async function deleteUserSessions(userId) {
  if (!userId) return
  await getPool().query(`DELETE FROM sessions WHERE user_id = $1`, [userId])
}

/** Best-effort cleanup of expired rows. Safe to call opportunistically. */
export async function deleteExpiredSessions() {
  await getPool().query(`DELETE FROM sessions WHERE expires_at <= NOW()`)
}

/**
 * Cookie attributes shared by every route that sets the session cookie.
 *   - httpOnly: client JS can't read the token (blocks XSS exfiltration).
 *   - secure:   HTTPS-only in production; off in dev so http://localhost works.
 *   - sameSite: 'lax' by default — the SPA and API are subdomains of the
 *               same registrable domain, so this still sends the cookie on
 *               XHR while blocking cross-site POST CSRF.
 *   - maxAge:   seconds (config.session.ttlDays), matches the DB expiry.
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: config.session.secure,
    sameSite: config.session.sameSite,
    path: '/',
    domain: config.session.domain,
    maxAge: config.session.ttlDays * 24 * 60 * 60,
  }
}

/** Options for clearing the cookie — must match path/domain to delete it. */
export function clearCookieOptions() {
  return {
    httpOnly: true,
    secure: config.session.secure,
    sameSite: config.session.sameSite,
    path: '/',
    domain: config.session.domain,
  }
}
