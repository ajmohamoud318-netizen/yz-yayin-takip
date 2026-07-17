/**
 * Password reset service.
 *
 *   1. `createPasswordReset({ userId })`  — mints a 32-char token,
 *      inserts a row in `password_resets`, returns { token, url }.
 *      Old outstanding tokens for the same user are invalidated so only
 *      the most recent link works.
 *   2. `verifyPasswordReset(token)`        — looks up an unused, unexpired
 *      row. Throws otherwise.
 *   3. `consumePasswordReset(token)`      — marks the row used so the
 *      link can't be re-played.
 *
 * Mirrors the invitations service shape so routes stay declarative.
 */

import { nanoid } from 'nanoid'
import { getPool } from '../db/pool.js'
import { config } from '../config.js'
import { badRequest, gone, notFound } from '../domain/errors.js'

const RESET_TTL_MINUTES = 60

export async function createPasswordReset({ userId }) {
  const token = nanoid(32)
  // Invalidate any outstanding tokens for this user so the most recent
  // email is the only one that works. The old rows stay in the table
  // for forensics but become un-consumable via used_at IS NOT NULL.
  await getPool().query(
    `UPDATE password_resets SET used_at = NOW()
      WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  )
  const { rows } = await getPool().query(
    `INSERT INTO password_resets (user_id, token, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' minutes')::INTERVAL)
     RETURNING id, token, expires_at`,
    [userId, token, String(RESET_TTL_MINUTES)],
  )
  const row = rows[0]
  return {
    id: row.id,
    token: row.token,
    expiresAt: row.expires_at,
    url: buildResetUrl(row.token),
  }
}

export function buildResetUrl(token) {
  const base = config.inviteBaseUrl.replace(/\/$/, '')
  return `${base}/reset-password?token=${encodeURIComponent(token)}`
}

/**
 * Return the reset row + user if `token` is valid. Throws otherwise.
 *  - notFound → token does not exist
 *  - gone     → token already used or expired
 */
export async function verifyPasswordReset(token) {
  if (!token) badRequest('Sıfırlama token\'ı zorunlu.')
  const { rows } = await getPool().query(
    `SELECT pr.id           AS reset_id,
            pr.token,
            pr.expires_at,
            pr.used_at,
            u.id            AS user_id,
            u.name,
            u.email,
            u.is_active
       FROM password_resets pr
       JOIN users u ON u.id = pr.user_id
      WHERE pr.token = $1
      LIMIT 1`,
    [token],
  )
  const row = rows[0]
  if (!row) notFound('Sıfırlama bağlantısı bulunamadı.')
  if (row.used_at) gone('Bu sıfırlama bağlantısı daha önce kullanılmış.')
  if (new Date(row.expires_at).getTime() < Date.now()) {
    gone('Sıfırlama bağlantısının süresi dolmuş. Yeni bir tane isteyin.')
  }
  if (row.is_active === false) {
    gone('Bu hesap devre dışı bırakılmış.')
  }
  return {
    resetId: row.reset_id,
    token: row.token,
    expiresAt: row.expires_at,
    user: {
      id: row.user_id,
      name: row.name,
      email: row.email,
    },
  }
}

/** Mark the reset token used so the link can't be re-played. */
export async function consumePasswordReset(resetId) {
  await getPool().query(
    `UPDATE password_resets
        SET used_at = NOW()
      WHERE id = $1`,
    [resetId],
  )
}