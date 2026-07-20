/**
 * Magic-link auth tokens.
 *
 * Replaces password-based login with a one-time signed link sent by
 * email. Token shape mirrors `invitations.js` (nanoid 32-char token,
 * Redis SET with TTL), but with a few differences:
 *
 *   - Storage is Redis (not Postgres) — short TTL, single-use, no FK
 *     cleanup needed.
 *   - Token binds to a user_id; consume returns the user id.
 *   - Single-use: consume() deletes the key.
 *
 * We deliberately keep this separate from `invitations.js`:
 *   - An invitation is "join the team"; a magic link is "log in".
 *   - Invitations live 7 days; magic links live 15 minutes.
 *   - Invitations are issued by the team_leader; magic links are
 *     self-service from the login form.
 */

import { nanoid } from 'nanoid'
import { getClient } from './redis.js'

const LINK_PREFIX = 'magic:'
const LINK_TTL_SECONDS = 15 * 60 // 15 minutes

/**
 * Mint a magic-link token for the given user and store it in Redis.
 * Returns { token, url }.
 *
 *   url = `${inviteBaseUrl}/auth/magic?token=${token}`
 */
export async function createMagicLink({ userId }) {
  const client = getClient()
  if (!client) {
    const err = new Error('Session store unavailable')
    err.status = 503
    throw err
  }
  const token = nanoid(32)
  // Value is just the userId; everything else we need (createdAt,
  // expiry) is in Redis metadata.
  await client.set(`${LINK_PREFIX}${token}`, userId, 'EX', LINK_TTL_SECONDS)
  return {
    token,
    ttlSeconds: LINK_TTL_SECONDS,
  }
}

/**
 * Atomically consume a magic-link token. Returns the userId if the
 * token existed and was unused; returns null otherwise.
 *
 * Single-use is guaranteed by `GETDEL` (Redis 6.2+): the key is
 * deleted as part of the read, so a second hit can't replay it.
 */
export async function consumeMagicLink(token) {
  if (!token) return null
  const client = getClient()
  if (!client) return null
  const userId = await client.getdel(`${LINK_PREFIX}${token}`)
  return userId || null
}

/**
 * Return the userId bound to a token WITHOUT consuming it. Useful for
 * the "we sent you a link" landing page that wants to show the email
 * address the link was sent to.
 */
export async function peekMagicLink(token) {
  if (!token) return null
  const client = getClient()
  if (!client) return null
  const userId = await client.get(`${LINK_PREFIX}${token}`)
  // Best-effort refresh so the preview page doesn't kill the link
  // before the user clicks it.
  if (userId) {
    await client.expire(`${LINK_PREFIX}${token}`, LINK_TTL_SECONDS)
  }
  return userId || null
}

export const MAGIC_LINK_TTL_SECONDS = LINK_TTL_SECONDS
