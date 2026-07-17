import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'
import { attachUser, requireRole } from '../middleware/auth.js'
import { badRequest, conflict, forbidden, notFound } from '../domain/errors.js'
import { getPool } from '../db/pool.js'
import { createInvitation } from '../services/invitations.js'
import { sendMail, renderInviteEmail } from '../services/mail.js'

/**
 * Users API.
 *
 *  GET    /api/users
 *  POST   /api/users/invite
 *  PATCH  /api/users/:id/deactivate
 *  PATCH  /api/users/:id/reactivate
 */
export async function userRoutes(fastify) {
  fastify.get('/users', async (request) => {
    await attachUser(request)
    const { rows } = await getPool().query(
      'SELECT id, name, email, role, is_active, invited_at, joined_at, created_at FROM users ORDER BY created_at',
    )
    return rows
  })

  fastify.post('/users/invite', async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const { name, email, role } = request.body ?? {}
    if (!name || !email) badRequest('Ad ve e-posta zorunlu.')
    if (!['designer', 'printer', 'satis'].includes(role)) {
      badRequest('Geçersiz rol.')
    }
    const normalisedEmail = email.trim().toLowerCase()
    const existing = await getPool().query(
      `SELECT id, is_active FROM users WHERE email = $1`,
      [normalisedEmail],
    )
    if (existing.rowCount > 0) {
      // Allow re-inviting a previously deactivated user — reactivate them
      // and mint a fresh invitation token. Active users still 409.
      if (!existing.rows[0].is_active) {
        const reactivated = await getPool().query(
          `UPDATE users SET is_active = TRUE, invited_at = NOW(), name = $2, role = $3
           WHERE id = $1
           RETURNING id, name, email, role, is_active, invited_at, joined_at, created_at`,
          [existing.rows[0].id, name.trim(), role],
        )
        const user = reactivated.rows[0]
        const invitation = await createInvitation({ userId: user.id })
        const { subject, text, html } = renderInviteEmail({
          name: user.name,
          role: user.role,
          inviteUrl: invitation.url,
          invitedBy: request.user?.name,
        })
        const mailResult = await sendMail({ to: user.email, subject, text, html })
        return {
          ...user,
          invitation: {
            url: invitation.url,
            token: invitation.token,
            expiresAt: invitation.expiresAt,
            emailSent: mailResult.ok,
            emailError: mailResult.ok ? null : mailResult.error,
            reactivated: true,
          },
        }
      }
      conflict('Bu e-posta zaten kayıtlı.')
    }

    // Create the user WITHOUT a password. They'll set it via the invite
    // link. `invited_at` records when the invite was sent; `joined_at`
    // gets stamped later when they accept.
    //
    // The `users` table uses TEXT primary keys (so seeded human-readable
    // ids like 'u-ayse' work), with no default. We mint a `u-<nanoid>` for
    // invited accounts — short, unique, and consistent with the seed
    // prefix used by the demo data migration.
    const userId = `u-${nanoid(16)}`
    const { rows } = await getPool().query(
      `INSERT INTO users (id, name, email, role, is_active, invited_at)
       VALUES ($1,$2,$3,$4,TRUE,NOW())
       RETURNING id, name, email, role, is_active, invited_at, joined_at, created_at`,
      [userId, name.trim(), normalisedEmail, role],
    )
    const user = rows[0]

    // Mint an invitation token + URL.
    const invitation = await createInvitation({ userId: user.id })

    // Try to send the email. Never block the invite on a mail outage —
    // surface the URL to the caller so they can forward it manually.
    const { subject, text, html } = renderInviteEmail({
      name: user.name,
      role: user.role,
      inviteUrl: invitation.url,
      invitedBy: request.user?.name,
    })
    const mailResult = await sendMail({
      to: user.email,
      subject,
      text,
      html,
    })

    return {
      ...user,
      invitation: {
        url: invitation.url,
        token: invitation.token,
        expiresAt: invitation.expiresAt,
        emailSent: mailResult.ok,
        emailError: mailResult.ok ? null : mailResult.error,
      },
    }
  })

  fastify.patch('/users/:id/deactivate', async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const { id } = request.params
    if (id === request.user.id) forbidden('Kendinizi devre dışı bırakamazsınız.')
    const { rows } = await getPool().query(
      `UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1
       RETURNING id, name, email, role, is_active`,
      [id],
    )
    if (!rows[0]) notFound('Kullanıcı bulunamadı.')
    return rows[0]
  })

  fastify.patch('/users/:id/reactivate', async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const { id } = request.params
    const { rows } = await getPool().query(
      `UPDATE users SET is_active = TRUE, updated_at = NOW() WHERE id = $1
       RETURNING id, name, email, role, is_active`,
      [id],
    )
    if (!rows[0]) notFound('Kullanıcı bulunamadı.')
    return rows[0]
  })
}
