import bcrypt from 'bcryptjs'
import { attachUser } from '../middleware/auth.js'
import { badRequest, forbidden, unauthorized } from '../domain/errors.js'
import { getPool } from '../db/pool.js'
import {
  consumeInvitation,
  verifyInvitation,
} from '../services/invitations.js'

/**
 * Auth API.
 *
 * Real Google OAuth is intentionally not yet wired (per the roadmap in
 * AGENTS.md). Instead we expose:
 *   POST /api/auth/login           — body { email, password }
 *   POST /api/auth/logout          — no-op for header auth.
 *   GET  /api/auth/me              — returns the attached user.
 *   GET  /api/auth/invite-preview  — body { token }, returns the invitee
 *                                    without consuming the token (so the
 *                                    "set password" page can render name).
 *   POST /api/auth/accept-invite   — body { token, password }, sets the
 *                                    password, marks the invitation used,
 *                                    returns { token, user }.
 *
 * This keeps the mock-auth UX in the SPA working with the new server
 * end-to-end. Next pass, replace /login + /me with the OAuth handshake.
 */

export async function authRoutes(fastify) {
  fastify.post('/auth/login', async (request) => {
    const { email, password } = request.body ?? {}
    if (!email || !password) unauthorized('E-posta ve şifre zorunlu.')
    const { rows } = await getPool().query(
      'SELECT id, name, email, password, role, is_active FROM users WHERE email = $1 LIMIT 1',
      [String(email).toLowerCase().trim()],
    )
    const user = rows[0]
    if (!user) unauthorized('E-posta veya şifre hatalı.')
    if (user.is_active === false) forbidden('Hesabınız devre dışı bırakılmış.')
    if (!user.password) unauthorized('Şifre tanımlı değil.')
    const ok = bcrypt.compareSync(String(password), user.password)
    if (!ok) unauthorized('E-posta veya şifre hatalı.')
    const { password: _pw, ...safe } = user
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
