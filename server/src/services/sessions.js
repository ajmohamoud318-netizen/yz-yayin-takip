/**
 * Session store — Redis-backed opaque sessions.
 *
 * The cookie only carries an opaque sid + a hint expiry. All user data
 * lives here, keyed by `session:<sid>` in Redis. This means:
 *   - Forging a cookie requires both the secret AND a Redis sid that
 *     doesn't exist yet — impossible without server access.
 *   - Logging out deletes the row, immediately invalidating the cookie
 *     even if the browser hasn't expired it yet.
 *   - Sliding refresh: every authenticated request bumps the TTL so
 *     active users stay signed in indefinitely.
 *
 * The store degrades gracefully if Redis is unreachable: `createSession`
 * throws so the route handler can return a 503 (login is broken without
 * sessions). Read paths return null and the route layer turns that into
 * a 401 — exactly the same behavior as "session not found".
 */

import { nanoid } from 'nanoid'
import { getClient } from './redis.js'
import { SESSION_MAX_AGE_MS } from './cookies.js'

const SESSION_PREFIX = 'session:'

/**
 * Create a new session for `userId`, returning { sid, expiresAt }.
 *
 * `userId` is stored alongside the sid so the auth middleware doesn't
 * have to do a second Redis hit on every request — it's already known
 * at session-create time. The user object itself comes from Postgres
 * (so it stays fresh) but the user_id → session mapping is here.
 */
export async function createSession(userId) {
  const client = getClient()
  if (!client) {
    const err = new Error('Session store unavailable')
    err.status = 503
    throw err
  }
  const sid = nanoid(40)
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS)
  const payload = JSON.stringify({
    userId,
    createdAt: new Date().toISOString(),
  })
  // SET ... EX seconds — atomic write + TTL in one round-trip.
  await client.set(`${SESSION_PREFIX}${sid}`, payload, 'EX', Math.floor(SESSION_MAX_AGE_MS / 1000))
  return { sid, expiresAt }
}

/**
 * Look up a session by id. Returns { userId, createdAt, expiresAt } if
 * the row exists AND hasn't expired (Redis handles the expiry
 * automatically — expired keys just vanish). Returns null otherwise.
 */
export async function getSession(sid) {
  if (!sid) return null
  const client = getClient()
  if (!client) return null
  const raw = await client.get(`${SESSION_PREFIX}${sid}`)
  if (!raw) return null
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed?.userId) return null

  const ttl = await client.ttl(`${SESSION_PREFIX}${sid}`)
  const expiresAt = ttl > 0 ? new Date(Date.now() + ttl * 1000) : null

  // Sliding refresh: bump TTL on every successful read so an active
  // session never expires mid-workflow. Cheap — a single Redis EXPIRE
  // call. We only refresh if the session has at least 1 day left, to
  // avoid pinning near-dead sessions forever.
  if (ttl > 24 * 60 * 60) {
    await client.expire(`${SESSION_PREFIX}${sid}`, Math.floor(SESSION_MAX_AGE_MS / 1000))
  }

  return {
    userId: parsed.userId,
    createdAt: parsed.createdAt,
    expiresAt,
  }
}

/** Destroy a session. Used on logout. Idempotent. */
export async function destroySession(sid) {
  if (!sid) return
  const client = getClient()
  if (!client) return
  await client.del(`${SESSION_PREFIX}${sid}`)
}
