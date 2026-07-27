import bcrypt from 'bcryptjs'
import { attachUser, loadUserById } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { badRequest, forbidden, unauthorized } from '../domain/errors.js'
import { getPool } from '../db/pool.js'
import { schemas } from '../schemas/index.js'
import {
  createSession,
  deleteSession,
  deleteUserSessions,
  sessionCookieOptions,
  clearCookieOptions,
} from '../services/sessions.js'
import { config } from '../config.js'
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
  /**
   * Mint a session for `userId` and attach it as the httpOnly session
   * cookie on `reply`. Shared by login, dev-login, accept-invite, and
   * reset-password (the last two auto-sign-in after setting a password).
   */
  async function issueSession(reply, userId) {
    const session = await createSession({ userId })
    reply.setCookie(config.session.cookieName, session.token, sessionCookieOptions())
  }

  /**
   * Login is the single most attacked endpoint on any app. We limit
   * by both IP and email so that:
   *   • one IP can't burn through 1000s of attempts against one email
   *   • a botnet rotating IPs still hits the per-email bucket
   *
   * 10 attempts per 5 minutes per bucket — generous enough that a
   * legitimate user with typos won't get locked out, tight enough to
   * make brute-force impractical. JSON-schema validation on the
   * body (schemas.authLogin) enforces required email + password +
   * minimum lengths, so the handler can trust the shape that arrives.
   */
  fastify.post(
    '/auth/login',
    {
      schema: schemas.authLogin,
      preHandler: rateLimit({
        keys: [
          (req) => `auth-login:ip:${req.ip}`,
          (req) => req.body?.email
            ? `auth-login:email:${String(req.body.email).toLowerCase().trim()}`
            : null,
        ],
        limit: 10,
        windowMs: 5 * 60_000,
        message: 'Çok fazla giriş denemesi. Lütfen 5 dakika sonra tekrar deneyin.',
      }),
    },
    async (request, reply) => {
    const { email, password } = request.body
    const { rows } = await getPool().query(
      `SELECT id, name, email, password, role, is_active, avatar_url, avatar_updated_at,
              CASE WHEN daily_status_date = CURRENT_DATE THEN daily_status END AS daily_status
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
    // Establish a server-side session and hand it back as an httpOnly
    // cookie. `token` is kept in the body for backward-compat with older
    // SPA builds (harmless — the server no longer trusts it in prod).
    await issueSession(reply, user.id)
    return { token: user.id, user: safe }
    },
  )

  fastify.post('/auth/logout', async (request, reply) => {
    const token = request.cookies?.[config.session.cookieName]
    await deleteSession(token)
    reply.clearCookie(config.session.cookieName, clearCookieOptions())
    return { ok: true }
  })

  fastify.get('/auth/me', async (request) => {
    await attachUser(request)
    return { user: request.user }
  })

  /**
   * Look up an invitation by token so the AcceptInvite page can render
   * the invitee's name + email without burning the token. Throws 404 / 410
   * for unknown or expired tokens so the UI can show the right message.
   */
  fastify.get('/auth/invite-preview', { schema: schemas.authInvitePreview }, async (request) => {
    const { token } = request.query
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
  /**
   * Accept-invite consumes a token from the email link. Per-IP limit
   * stops a flood of malformed-token probes (the DB lookup is the
   * expensive bit); per-token limit defeats brute-forcing the 64-char
   * invite token from a single IP. 20 per 15min on each bucket.
   * Schema validation enforces token + password presence + 8-char
   * minimum so the handler can trust the body shape.
   */
  fastify.post(
    '/auth/accept-invite',
    {
      schema: schemas.authAcceptInvite,
      preHandler: rateLimit({
        keys: [
          (req) => `auth-accept:ip:${req.ip}`,
          (req) => req.body?.token
            ? `auth-accept:token:${req.body.token}`
            : null,
        ],
        limit: 20,
        windowMs: 15 * 60_000,
        message: 'Çok fazla deneme. Lütfen 15 dakika sonra tekrar deneyin.',
      }),
    },
    async (request, reply) => {
    const { token, password } = request.body
    const inv = await verifyInvitation(token)
    const hash = bcrypt.hashSync(password, 12)
    const { rows } = await getPool().query(
      `UPDATE users
          SET password = $1,
              joined_at = COALESCE(joined_at, NOW()),
              updated_at = NOW()
        WHERE id = $2
        RETURNING id, name, email, role, is_active,
                  CASE WHEN daily_status_date = CURRENT_DATE THEN daily_status END AS daily_status`,
      [hash, inv.user.id],
    )
    const user = rows[0]
    await consumeInvitation(inv.invitationId)
    await issueSession(reply, user.id)
    return { token: user.id, user }
    },
  )

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
      schema: schemas.authForgotPassword,
      preHandler: rateLimit({
        keys: [(req) => `auth-forgot:ip:${req.ip}`],
        limit: 5,
        windowMs: 60_000,
        message: 'Çok fazla şifre sıfırlama isteği. Lütfen bir dakika bekleyin.',
      }),
    },
    async (request) => {
      const { email } = request.body
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
  /**
   * Reset-password consumes a one-shot token. Same protection as
   * accept-invite: per-IP + per-token bucket so a leaked/burning set
   * of tokens can't be probed at scale. Schema validation enforces
   * token + password presence + 8-char minimum so the handler can
   * trust the body shape.
   */
  fastify.post(
    '/auth/reset-password',
    {
      schema: schemas.authResetPassword,
      preHandler: rateLimit({
        keys: [
          (req) => `auth-reset:ip:${req.ip}`,
          (req) => req.body?.token
            ? `auth-reset:token:${req.body.token}`
            : null,
        ],
        limit: 20,
        windowMs: 15 * 60_000,
        message: 'Çok fazla deneme. Lütfen 15 dakika sonra tekrar deneyin.',
      }),
    },
    async (request, reply) => {
    const { token, password } = request.body
    const reset = await verifyPasswordReset(token)
    const hash = bcrypt.hashSync(password, 12)
    const { rows } = await getPool().query(
      `UPDATE users
          SET password = $1,
              updated_at = NOW()
        WHERE id = $2
        RETURNING id, name, email, role, is_active,
                  CASE WHEN daily_status_date = CURRENT_DATE THEN daily_status END AS daily_status`,
      [hash, reset.user.id],
    )
    const user = rows[0]
    await consumePasswordReset(reset.resetId)
    // Invalidate any other live sessions for this account — a password
    // reset should log out sessions the (possibly compromised) old
    // credential established — then sign the user in fresh.
    await deleteUserSessions(user.id)
    await issueSession(reply, user.id)
    return { token: user.id, user }
    },
  )

  /**
   * Change-password for the currently-authenticated user. Requires
   * the current password as proof. Returns 204 on success.
   *
   * Used by the Settings page so anyone can rotate their own password
   * without going through the forgot-password email loop.
   */
  fastify.patch('/auth/change-password', { schema: schemas.authChangePassword }, async (request) => {
    await attachUser(request)
    const { currentPassword, newPassword } = request.body
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
    const hash = bcrypt.hashSync(newPassword, 12)
    await getPool().query(
      `UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`,
      [hash, request.user.id],
    )
    return { ok: true }
  })

  // Dev-only "log in as" endpoint. Lets the SPA drive the backend end to
  // end without going through email + password (the seed rows don't carry
  // a bcrypt hash yet). Disabled in production via NODE_ENV.
  fastify.post('/auth/dev-login', { schema: schemas.authDevLogin }, async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      unauthorized('Dev login disabled in production')
    }
    const { user_id: userId } = request.body
    const user = await loadUserById(userId)
    if (!user) unauthorized('Unknown user')
    if (user.is_active === false) forbidden('Hesabınız devre dışı bırakılmış.')
    await issueSession(reply, user.id)
    return { token: user.id, user }
  })
}
