/**
 * Invitation service.
 *
 * Owns the lifecycle of a pending invite:
 *   1. `createInvitation({ userId })`  — mints a token, inserts a row in
 *      `invitations`, returns { token, url }.
 *   2. `verifyInvitation(token)`        — looks up an active (unused, not
 *      expired) row; returns the invitation + user. Throws otherwise.
 *   3. `consumeInvitation(token)`      — marks the row used so the link
 *      can't be re-played.
 *
 * Keeping these helpers in one place means the routes stay declarative
 * and the token shape is owned by one file.
 */

import { nanoid } from 'nanoid'
import { getPool } from '../db/pool.js'
import { config } from '../config.js'
import { badRequest, gone, notFound, unauthorized } from '../domain/errors.js'

const INVITE_TTL_DAYS = 7

export async function createInvitation({ userId }) {
  const token = nanoid(32)
  const { rows } = await getPool().query(
    `INSERT INTO invitations (user_id, token, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' days')::INTERVAL)
     RETURNING id, token, expires_at`,
    [userId, token, String(INVITE_TTL_DAYS)],
  )
  const inv = rows[0]
  return {
    id: inv.id,
    token: inv.token,
    expiresAt: inv.expires_at,
    url: buildInviteUrl(inv.token),
  }
}

export function buildInviteUrl(token) {
  const base = config.inviteBaseUrl.replace(/\/$/, '')
  return `${base}/accept-invite?token=${encodeURIComponent(token)}`
}

/**
 * Return the invitation + user if `token` is valid (unused, unexpired,
 * user active, password not yet set). Otherwise throws.
 *
 *   - notFound   → token does not exist
 *   - gone       → token already used or expired
 *   - forbidden  → user is deactivated
 *   - badRequest → user already set a password (re-invite instead)
 */
export async function verifyInvitation(token) {
  if (!token) badRequest('Davet token\'ı zorunlu.')
  const { rows } = await getPool().query(
    `SELECT i.id AS invitation_id,
            i.token,
            i.expires_at,
            i.used_at,
            u.id   AS user_id,
            u.name,
            u.email,
            u.role,
            u.is_active,
            u.password
       FROM invitations i
       JOIN users u ON u.id = i.user_id
      WHERE i.token = $1
      LIMIT 1`,
    [token],
  )
  const row = rows[0]
  if (!row) notFound('Davet bulunamadı.')
  if (row.used_at) gone('Bu davet linki daha önce kullanılmış.')
  if (new Date(row.expires_at).getTime() < Date.now()) {
    gone('Davet linkinin süresi dolmuş. Yeni bir davet isteyin.')
  }
  if (row.is_active === false) {
    unauthorized('Bu hesap devre dışı bırakılmış.')
  }
  if (row.password) {
    badRequest('Bu hesap için zaten şifre belirlenmiş. Giriş yapabilirsiniz.')
  }
  return {
    invitationId: row.invitation_id,
    token: row.token,
    expiresAt: row.expires_at,
    user: {
      id: row.user_id,
      name: row.name,
      email: row.email,
      role: row.role,
    },
  }
}

/** Mark the invitation used so the link can't be re-played. */
export async function consumeInvitation(invitationId) {
  await getPool().query(
    `UPDATE invitations
        SET used_at = NOW()
      WHERE id = $1`,
    [invitationId],
  )
}