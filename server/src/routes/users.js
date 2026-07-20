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
 *  PATCH  /api/users/:id/capabilities   — set `can_approve_ozalit`
 *  DELETE /api/users/:id
 */
export async function userRoutes(fastify) {
  const USER_COLUMNS =
    'id, name, email, role, is_active, can_approve_ozalit, invited_at, joined_at, created_at'

  fastify.get('/users', async (request) => {
    await attachUser(request)
    const { rows } = await getPool().query(
      `SELECT ${USER_COLUMNS} FROM users ORDER BY created_at`,
    )
    return rows
  })

  fastify.post('/users/invite', async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const { name, email, role, canApproveOzalit } = request.body ?? {}
    if (!name || !email) badRequest('Ad ve e-posta zorunlu.')
    if (!['designer', 'printer', 'satis', 'team_leader'].includes(role)) {
      badRequest('Geçersiz rol.')
    }
    // The "special designer" capability only makes sense on the designer
    // role. Silently coerce to false otherwise so the form can stay
    // unchecked-by-default without surprising the user with a 400.
    const wantsFlag = role === 'designer' && canApproveOzalit === true
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
          `UPDATE users SET is_active = TRUE, invited_at = NOW(), name = $2, role = $3,
                  can_approve_ozalit = $4
           WHERE id = $1
           RETURNING ${USER_COLUMNS}`,
          [existing.rows[0].id, name.trim(), role, wantsFlag],
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
      `INSERT INTO users (id, name, email, role, is_active, can_approve_ozalit, invited_at)
       VALUES ($1,$2,$3,$4,TRUE,$5,NOW())
       RETURNING ${USER_COLUMNS}`,
      [userId, name.trim(), normalisedEmail, role, wantsFlag],
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

  // Per-row toggle for the team-leader invite UI. Only the canApproveOzalit
  // capability is exposed here — anything else lives on the user invite /
  // deactivate endpoints.
  fastify.patch('/users/:id/capabilities', async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const { id } = request.params
    const { canApproveOzalit } = request.body ?? {}
    if (typeof canApproveOzalit !== 'boolean') {
      badRequest('canApproveOzalit boolean olmalı.')
    }

    // Pull current row so we can enforce "only on designers".
    const { rows: current } = await getPool().query(
      `SELECT role FROM users WHERE id = $1`,
      [id],
    )
    if (!current[0]) notFound('Kullanıcı bulunamadı.')
    if (current[0].role !== 'designer') {
      badRequest('Bu yetki yalnızca tasarımcılar için geçerlidir.')
    }

    const { rows } = await getPool().query(
      `UPDATE users SET can_approve_ozalit = $2, updated_at = NOW() WHERE id = $1
       RETURNING ${USER_COLUMNS}`,
      [id, canApproveOzalit],
    )
    return rows[0]
  })

  fastify.patch('/users/:id/deactivate', async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const { id } = request.params
    if (id === request.user.id) forbidden('Kendinizi devre dışı bırakamazsınız.')
    const { rows } = await getPool().query(
      `UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1
       RETURNING ${USER_COLUMNS}`,
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
       RETURNING ${USER_COLUMNS}`,
      [id],
    )
    if (!rows[0]) notFound('Kullanıcı bulunamadı.')
    return rows[0]
  })

  // Hard delete. Cascades to invitations; subtasks / projects that
  // reference the user become orphan assignee pointers (NULL via FK).
  // team_leader only, and you can't delete yourself.
  fastify.delete('/users/:id', async (request, reply) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const { id } = request.params
    if (id === request.user.id) forbidden('Kendinizi silemezsiniz.')
    const { rows } = await getPool().query(
      `DELETE FROM users WHERE id = $1 RETURNING id`,
      [id],
    )
    if (!rows[0]) return notFound('Kullanıcı bulunamadı.')
    reply.code(204)
    return null
  })
}
