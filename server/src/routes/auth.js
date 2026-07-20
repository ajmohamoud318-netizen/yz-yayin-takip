import bcrypt from 'bcryptjs'
import { attachUser } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { badRequest, forbidden, unauthorized } from '../domain/errors.js'
import { getPool } from '../db/pool.js'
import {
  consumeInvitation,
  verifyInvitation,
} from '../services/invitations.js'
import {
  consumePasswordReset,
  createPasswordReset,
  verifyPasswordReset,
} from '../services/password-resets.js'
import { sendMail, renderResetEmail } from '../services/mail.js'

/**
 * Auth API.
 *
 * Real Google OAuth is intentionally not yet wired (per the roadmap in
 * AGENTS.md). Instead we expose:
 *   POST /api/auth/login             — body { email, password }
 *   POST /api/auth/logout            — no-op for header auth.
 *   GET  /api/auth/me                — returns the attached user.
 *   GET  /api/auth/invite-preview    — body { token }, returns the invitee
 *                                      without consuming the token (so the
 *                                      "set password" page can render name).
 *   POST /api/auth/accept-invite     — body { token, password }, sets the
 *                                      password, marks the invitation used,
 *                                      returns { token, user }.
 *   POST /api/auth/forgot-password   — body { email }, always returns 200,
 *                                      sends a reset email if the address
 *                                      matches an active user. Rate-limited
 *                                      to 5 requests/minute per IP.
 *   POST /api/auth/reset-password    — body { token, password }, consumes
 *                                      the reset token and sets a new
 *                                      bcrypt password.
 *   PATCH /api/auth/change-password  — body { currentPassword, newPassword },
 *                                      rotates the caller's own password.
 *                                      Requires the current password unless
 *                                      the account has none yet (first-time
 *                                      set after an invite).
 *
 * This keeps the mock-auth UX in the SPA working with the new server
 * end-to-end. Next pass, replace /login + /me with the OAuth handshake.
 */

export async function authRoutes(fastify) {
  fastify.post('/auth/login', async (request) => {
    const { email, password } = request.body ?? {}
    if (!email || !password) unauthorized('E-posta ve şifre zorunlu.')
    const { rows } = await getPool().query(
      `SELECT id, name, email, password, role, is_active, avatar_url, avatar_updated_at
       FROM users WHERE email = $1 LIMIT 1`,
      [String(email).toLowerCase().trim()],
    )
    const user = rows[0]
    if (!user) unauthorized('E-posta veya şifre hatalı.')
    if (user.is_active === false) forbidden('Hesabınız devre dışı bırakılmış.')
    if (!user.password) unauthorized('Şifre tanımlı değil.')
    const ok = bcrypt.compareSync(String(password), user.password)
    if (!ok) unauthorized('E-posta veya şifre hatalı.')
    const { password: _pw, ...safe } = user
    // Drop the password column, keep avatar_url. Stored value is already
    // a relative path so the SPA can rewrite against the live backend host.
    return { token: user.id, user: safe }
  })

  fastify.post('/auth/logout', async () => ({ ok: true }))

  fastify.get('/auth/me', async (request) => {
    await attachUser(request)
    return { user: request.user }
  })

  /**
   * Look up an invitation by token so the AcceptInvite page can render
   * the invitee's name + email without burning the token. Throws 404 / 410
   * for unknown or expired tokens so the UI can show the right message.
   */
  fastify.get('/auth/invite-preview', async (request) => {
    const { token } = request.query ?? {}
    const inv = await verifyInvitation(token)
    return {
      name: inv.user.name,
      email: inv.user.email,
      role: inv.user.role,
      expiresAt: inv.expiresAt,
    }
  })

  /**
   * Consume an invitation token and set the user's password.
   * Returns { token, user } so the client can sign the user straight in.
   */
  fastify.post('/auth/accept-invite', async (request) => {
    const { token, password } = request.body ?? {}
    if (!token) badRequest('Davet token\'ı zorunlu.')
    if (!password || typeof password !== 'string') {
      badRequest('Şifre zorunlu.')
    }
    if (password.length < 8) {
      badRequest('Şifre en az 8 karakter olmalı.')
    }
    const inv = await verifyInvitation(token)
    const hash = bcrypt.hashSync(password, 10)
    const { rows } = await getPool().query(
      `UPDATE users
          SET password = $1,
              joined_at = COALESCE(joined_at, NOW()),
              updated_at = NOW()
        WHERE id = $2
        RETURNING id, name, email, role, is_active`,
      [hash, inv.user.id],
    )
    const user = rows[0]
    await consumeInvitation(inv.invitationId)
    return { token: user.id, user }
  })

  /**
   * Forgot-password — always returns 200 even when the email doesn't
   * exist, so attackers can't enumerate accounts by probing the API.
   * If the email is real we mint a 1-hour token + send a reset link.
   *
   * Rate-limited to 5 requests per minute per IP — without this an
   * attacker could burn through Resend quota by POSTing random
   * addresses. The limit is per-IP not per-email because the spam
   * vector is automated, not human.
   */
  fastify.post(
    '/auth/forgot-password',
    {
      preHandler: rateLimit({
        key: (req) => req.ip,
        limit: 5,
        windowMs: 60_000,
      }),
    },
    async (request) => {
      const { email } = request.body ?? {}
      if (!email || typeof email !== 'string') {
        return { ok: true }
      }
      const normalisedEmail = email.trim().toLowerCase()
      const { rows } = await getPool().query(
        `SELECT id, name, email, is_active FROM users WHERE email = $1 LIMIT 1`,
        [normalisedEmail],
      )
      const user = rows[0]
      if (user && user.is_active !== false) {
        const reset = await createPasswordReset({ userId: user.id })
        const { subject, text, html } = renderResetEmail({
          name: user.name,
          resetUrl: reset.url,
        })
        // Same never-throws contract as the invite email — a transient
        // SMTP outage should not block the forgot-password flow. We log
        // it; the user will see "no email arrived" and try again.
        await sendMail({ to: user.email, subject, text, html })
      }
      return { ok: true }
    },
  )

  /**
   * Reset-password — consumes the token, sets a new bcrypt password.
   * Returns { token, user } so the SPA can log the user straight in
   * without a second round-trip.
   */
  fastify.post('/auth/reset-password', async (request) => {
    const { token, password } = request.body ?? {}
    if (!password || typeof password !== 'string') {
      badRequest('Yeni şifre zorunlu.')
    }
    if (password.length < 8) {
      badRequest('Şifre en az 8 karakter olmalı.')
    }
    const reset = await verifyPasswordReset(token)
    const hash = bcrypt.hashSync(password, 10)
    const { rows } = await getPool().query(
      `UPDATE users
          SET password = $1,
              updated_at = NOW()
        WHERE id = $2
        RETURNING id, name, email, role, is_active`,
      [hash, reset.user.id],
    )
    const user = rows[0]
    await consumePasswordReset(reset.resetId)
    return { token: user.id, user }
  })

  /**
   * Change-password for the currently-authenticated user. Requires
   * the current password as proof. Returns 204 on success.
   *
   * Used by the Settings page so anyone can rotate their own password
   * without going through the forgot-password email loop.
   */
  fastify.patch('/auth/change-password', async (request) => {
    await attachUser(request)
    const { currentPassword, newPassword } = request.body ?? {}
    if (!currentPassword || typeof currentPassword !== 'string') {
      badRequest('Mevcut şifre zorunlu.')
    }
    if (!newPassword || typeof newPassword !== 'string') {
      badRequest('Yeni şifre zorunlu.')
    }
    if (newPassword.length < 8) {
      badRequest('Yeni şifre en az 8 karakter olmalı.')
    }
    if (newPassword === currentPassword) {
      badRequest('Yeni şifre mevcut şifreden farklı olmalı.')
    }

    const { rows } = await getPool().query(
      `SELECT id, password, is_active FROM users WHERE id = $1 LIMIT 1`,
      [request.user.id],
    )
    const row = rows[0]
    if (!row) forbidden('Kullanıcı bulunamadı.')
    if (row.is_active === false) forbidden('Bu hesap devre dışı bırakılmış.')
    // If the user has never set a password (invited but never accepted),
    // skip the current-password check — they're setting it for the first
    // time. requireOld is implicit because no other password exists.
    if (row.password && !bcrypt.compareSync(currentPassword, row.password)) {
      unauthorized('Mevcut şifre yanlış.')
    }
    const hash = bcrypt.hashSync(newPassword, 10)
    await getPool().query(
      `UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`,
      [hash, request.user.id],
    )
    return { ok: true }
  })

  // Dev-only "log in as" endpoint. Lets the SPA drive the backend end to
  // end without going through email + password (the seed rows don't carry
  // a bcrypt hash yet). Disabled in production via NODE_ENV.
  fastify.post('/auth/dev-login', async (request) => {
    if (process.env.NODE_ENV === 'production') {
      unauthorized('Dev login disabled in production')
    }
    const { user_id: userId } = request.body ?? {}
    if (!userId) unauthorized('user_id zorunlu.')
    const user = await loadUserById(userId)
    if (!user) unauthorized('Unknown user')
    if (user.is_active === false) forbidden('Hesabınız devre dışı bırakılmış.')
    return { token: user.id, user }
  })
}
