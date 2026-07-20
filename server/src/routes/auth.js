import bcrypt from 'bcryptjs'
import { attachUser, loadUserById } from '../middleware/auth.js'
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
import {
  createMagicLink,
  consumeMagicLink,
  MAGIC_LINK_TTL_SECONDS,
} from '../services/magic-links.js'
import { renderMagicLinkEmail, buildMagicLinkUrl } from '../services/magic-link-email.js'
import { buildSessionCookie, buildLogoutCookie } from '../services/cookies.js'
import { createSession, destroySession } from '../services/sessions.js'
import { parseSessionCookie } from '../services/cookies.js'
import { config } from '../config.js'
import { schemas } from '../schemas/index.js'

/**
 * Auth API.
 *
 * Magic-link sign-in (current pass):
 *   POST /api/auth/magic             — body { email }, emails a 15-minute
 *                                       one-time signed link.
 *   GET  /api/auth/magic/callback    — query { token }, consumes the link,
 *                                       creates a Redis-backed session,
 *                                       sets the yz_sid cookie, redirects
 *                                       to the SPA.
 *   POST /api/auth/logout            — destroys the session and clears the
 *                                       cookie. Idempotent.
 *   GET  /api/auth/me                — returns the attached user (cookie).
 *   GET  /api/auth/invite-preview    — query { token }, returns the invitee
 *                                       without consuming it.
 *   POST /api/auth/accept-invite     — body { token, password }, sets the
 *                                       password and signs the user in.
 *   POST /api/auth/forgot-password   — body { email }, sends a reset email
 *                                       if the address matches an active
 *                                       user. Returns 200 either way.
 *   POST /api/auth/reset-password    — body { token, password }, consumes
 *                                       the reset token and sets a new
 *                                       bcrypt password.
 *   PATCH /api/auth/change-password  — body { currentPassword, newPassword }.
 *   POST /api/auth/dev-login         — NODE_ENV !== 'production' only;
 *                                       creates a session without email.
 */

export async function authRoutes(fastify) {
  /**
   * Magic-link request — always returns 200 even when the email doesn't
   * match a user, so attackers can't enumerate accounts. If the email
   * matches an active user, we mint a 15-minute one-time link and send
   * it via Resend (same pipeline as invite + reset emails).
   *
   * Rate-limited per-IP and per-email to defeat the two obvious abuse
   * vectors: someone spamming a single address, or a botnet rotating
   * IPs against a single address.
   */
  fastify.post(
    '/auth/magic',
    {
      schema: schemas.authLogin,
      preHandler: rateLimit({
        keys: [
          (req) => `auth-magic:ip:${req.ip}`,
          (req) => req.body?.email
            ? `auth-magic:email:${String(req.body.email).toLowerCase().trim()}`
            : null,
        ],
        limit: 10,
        windowMs: 15 * 60_000,
        message: 'Çok fazla giriş isteği. Lütfen 15 dakika sonra tekrar deneyin.',
      }),
    },
    async (request) => {
      const { email } = request.body
      if (!email) return { ok: true }
      const normalisedEmail = String(email).toLowerCase().trim()
      const { rows } = await getPool().query(
        `SELECT id, name, email, is_active FROM users WHERE email = $1 LIMIT 1`,
        [normalisedEmail],
      )
      const user = rows[0]
      if (user && user.is_active !== false) {
        const link = await createMagicLink({ userId: user.id })
        const magicUrl = buildMagicLinkUrl(link.token, config.inviteBaseUrl)
        const { subject, text, html } = renderMagicLinkEmail({
          name: user.name,
          magicUrl,
          ttlMinutes: Math.floor(link.ttlSeconds / 60),
        })
        // Same never-throws contract as invite / reset — a transient
        // SMTP outage shouldn't block the flow. The user will see "no
        // email arrived" and try again.
        await sendMail({ to: user.email, subject, text, html })
      }
      return { ok: true }
    },
  )

  /**
   * Magic-link callback — the user clicked the email link. Validate the
   * token, consume it (single-use), create a session, set the cookie,
   * redirect to the SPA.
   *
   * The SPA then polls GET /api/auth/me to confirm the session and
   * route the user to the dashboard.
   */
  fastify.get(
    '/auth/magic/callback',
    { schema: schemas.authMagicCallback },
    async (request, reply) => {
    const { token, next } = request.query
    if (!token) badRequest('Geçersiz bağlantı.')
    const userId = await consumeMagicLink(token)
    if (!userId) badRequest('Bu bağlantı geçersiz veya süresi dolmuş.')
    const session = await createSession(userId)
    reply.header('Set-Cookie', buildSessionCookie(session.sid, session.expiresAt))
    // Redirect back to the SPA. The `next` param lets the client send
    // the user to the page they originally tried to reach.
    const dest = (typeof next === 'string' && next.startsWith('/'))
      ? `${config.inviteBaseUrl.replace(/\/$/, '')}${next}`
      : `${config.inviteBaseUrl.replace(/\/$/, '')}/`
    reply.redirect(dest, 302)
  })

  /**
   * Logout — destroy the session row and clear the cookie. Idempotent
   * (no-op if there's no session).
   */
  fastify.post('/auth/logout', async (request, reply) => {
    const cookie = parseSessionCookie(request.headers.cookie)
    if (cookie) await destroySession(cookie.sid)
    reply.header('Set-Cookie', buildLogoutCookie())
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
   * Returns { user } so the client can sign the user straight in.
   * Now signs the user in via the same session-cookie flow as the
   * magic-link callback — accept-invite is a one-shot login.
   */
  fastify.post(
    '/auth/accept-invite',
    { schema: schemas.authAcceptInvite },
    async (request, reply) => {
    const { token, password } = request.body
    const inv = await verifyInvitation(token)
    const hash = bcrypt.hashSync(password, 10)
    const { rows } = await getPool().query(
      `UPDATE users
          SET password = $1,
              joined_at = COALESCE(joined_at, NOW()),
              updated_at = NOW()
        WHERE id = $2
        RETURNING id, name, email, role, is_active, avatar_url, avatar_updated_at`,
      [hash, inv.user.id],
    )
    const user = rows[0]
    await consumeInvitation(inv.invitationId)
    const session = await createSession(user.id)
    reply.header('Set-Cookie', buildSessionCookie(session.sid, session.expiresAt))
    return { user }
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
      if (!email) return { ok: true }
      const normalisedEmail = String(email).trim().toLowerCase()
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
   * Reset-password — consumes the token, sets a new bcrypt password,
   * signs the user in (session cookie). Returns { user } so the SPA
   * can navigate to the dashboard without a second login step.
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
      const hash = bcrypt.hashSync(password, 10)
      const { rows } = await getPool().query(
        `UPDATE users
            SET password = $1,
                updated_at = NOW()
          WHERE id = $2
          RETURNING id, name, email, role, is_active, avatar_url, avatar_updated_at`,
        [hash, reset.user.id],
      )
      const user = rows[0]
      await consumePasswordReset(reset.resetId)
      const session = await createSession(user.id)
      reply.header('Set-Cookie', buildSessionCookie(session.sid, session.expiresAt))
      return { user }
    },
  )

  /**
   * Change-password for the currently-authenticated user. Requires
   * the current password as proof. Used by the Settings page so anyone
   * can rotate their own password without going through the
   * forgot-password email loop. Returns { ok: true } on success.
   */
  fastify.patch(
    '/auth/change-password',
    { schema: schemas.authChangePassword },
    async (request) => {
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
    const hash = bcrypt.hashSync(newPassword, 10)
    await getPool().query(
      `UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`,
      [hash, request.user.id],
    )
    return { ok: true }
    },
  )

  // Dev-only "log in as" endpoint. Lets the SPA drive the backend end to
  // end without going through email + password (the seed rows don't carry
  // a bcrypt hash yet). Disabled in production via NODE_ENV.
  /**
   * Dev-only escape hatch: log in as any user without going through
   * email. Creates a real session + sets the cookie so the rest of
   * the app behaves exactly like a magic-link sign-in. Gated by
   * NODE_ENV !== 'production' — fails closed in prod.
   */
  fastify.post(
    '/auth/dev-login',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['user_id'],
          properties: { user_id: { type: 'string', minLength: 1, maxLength: 64 } },
        },
      },
    },
    async (request, reply) => {
      if (process.env.NODE_ENV === 'production') {
        unauthorized('Dev login disabled in production')
      }
      const { user_id: userId } = request.body
      const user = await loadUserById(userId)
      if (!user) unauthorized('Unknown user')
      if (user.is_active === false) forbidden('Hesabınız devre dışı bırakılmış.')
      const session = await createSession(userId)
      reply.header('Set-Cookie', buildSessionCookie(session.sid, session.expiresAt))
      const { password: _pw, ...safe } = user
      return { user: safe }
    },
  )
}
