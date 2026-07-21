import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'
import { attachUser, requireRole } from '../middleware/auth.js'
import { badRequest, conflict, forbidden, notFound, HttpError } from '../domain/errors.js'
import { getPool } from '../db/pool.js'
import { schemas } from '../schemas/index.js'
import { createInvitation } from '../services/invitations.js'
import { sendMail, renderInviteEmail } from '../services/mail.js'
import {
  MAX_AVATAR_BYTES,
  deleteAvatar,
  extForMime,
  isAllowedMime,
  readAvatar,
  saveAvatar,
} from '../services/avatars.js'

/**
 * Users API.
 *
 *  GET    /api/users
 *  POST   /api/users/invite
 *  PATCH  /api/users/:id/deactivate
 *  PATCH  /api/users/:id/reactivate
 *  PATCH  /api/users/:id/capabilities   { canApproveOzalit: boolean }
 *  DELETE /api/users/:id
 */
export async function userRoutes(fastify) {
  fastify.get('/users', async (request) => {
    await attachUser(request)
    const { rows } = await getPool().query(
      `SELECT id, name, email, role, is_active, can_approve_ozalit,
              invited_at, joined_at, created_at
         FROM users
        ORDER BY created_at`,
    )
    return rows
  })

  fastify.post('/users/invite', { schema: schemas.usersInvite }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    // The SPA surfaces a "Demo + Özalit onay yetkisi" toggle in the
    // invite dialog for designers. We accept it here and persist it on
    // the new row. Non-designers are always coerced to FALSE so the
    // column only ever makes sense for `role = 'designer'`.
    const { name, email, role, canApproveOzalit = false } = request.body
    const normalisedEmail = email.trim().toLowerCase()
    const persistedCapability = role === 'designer' ? !!canApproveOzalit : false
    const existing = await getPool().query(
      `SELECT id, is_active FROM users WHERE email = $1`,
      [normalisedEmail],
    )
    if (existing.rowCount > 0) {
      // Allow re-inviting a previously deactivated user — reactivate them
      // and mint a fresh invitation token. Active users still 409.
      if (!existing.rows[0].is_active) {
        const reactivated = await getPool().query(
          `UPDATE users
              SET is_active = TRUE,
                  invited_at = NOW(),
                  name = $2,
                  role = $3,
                  can_approve_ozalit = $4
            WHERE id = $1
        RETURNING id, name, email, role, is_active, can_approve_ozalit,
                  invited_at, joined_at, created_at`,
          [existing.rows[0].id, name.trim(), role, persistedCapability],
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
       RETURNING id, name, email, role, is_active, can_approve_ozalit,
                 invited_at, joined_at, created_at`,
      [userId, name.trim(), normalisedEmail, role, persistedCapability],
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

  fastify.patch('/users/:id/deactivate', { schema: schemas.userIdParams }, async (request) => {
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

  fastify.patch('/users/:id/reactivate', { schema: schemas.userIdParams }, async (request) => {
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

  // Toggle a per-user capability. Today the only exposed capability is
  // `can_approve_ozalit` (lets a designer reject/approve at Demo + Özalit).
  // We forward the boolean to the users.can_approve_ozalit column and
  // coerce to FALSE for non-designers on the server so the SPA never has
  // to second-guess role semantics.
  fastify.patch('/users/:id/capabilities', { schema: schemas.usersCapabilities }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const { id } = request.params
    const { canApproveOzalit } = request.body
    const target = await getPool().query('SELECT role FROM users WHERE id = $1', [id])
    if (target.rowCount === 0) notFound('Kullanıcı bulunamadı.')
    const newValue = target.rows[0].role === 'designer' ? canApproveOzalit : false
    const { rows } = await getPool().query(
      `UPDATE users SET can_approve_ozalit = $2, updated_at = NOW() WHERE id = $1
       RETURNING id, name, email, role, is_active, can_approve_ozalit`,
      [id, newValue],
    )
    return rows[0]
  })

  // Hard delete. Cascades to invitations / password_resets (FK ON DELETE
  // CASCADE); subtasks / projects / history / orders / handovers become
  // orphan assignee pointers (FK ON DELETE SET NULL). team_leader only,
  // and you can't delete yourself. Avatar files on disk are removed
  // explicitly so we don't leak storage on the persistent volume.
  fastify.delete('/users/:id', { schema: schemas.userIdParams }, async (request, reply) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const { id } = request.params
    if (id === request.user.id) forbidden('Kendinizi silemezsiniz.')
    const { rows } = await getPool().query(
      `DELETE FROM users WHERE id = $1 RETURNING id`,
      [id],
    )
    if (!rows[0]) return notFound('Kullanıcı bulunamadı.')
    // Best-effort avatar cleanup — never block the delete on a filesystem
    // error. Operators can `rm` orphans on the volume later if needed.
    try {
      await deleteAvatar(id)
    } catch (err) {
      request.log.warn(
        { err, userId: id },
        'avatar cleanup after user delete failed; continuing',
      )
    }
    reply.code(204)
    return null
  })

  // ─── Avatar upload / fetch / delete ─────────────────────────────
  //
  // Upload + delete are scoped to the *authenticated* user — there's
  // intentionally no `/users/:id/avatar` so one user can never overwrite
  // another. The file endpoint is public-ish (browsers load <img src>
  // without sending X-User-Id), so we don't 401 on missing auth there —
  // we just 404 if no avatar is on file.
  //
  // Body limit for this route is enforced per-upload via
  // `MAX_AVATAR_BYTES`; Fastify's global bodyLimit is the upper bound for
  // a defensive second check.

  fastify.put('/users/me/avatar', async (request) => {
    await attachUser(request)
    const file = await request.file()
    if (!file) badRequest('Dosya bulunamadı.')
    if (!isAllowedMime(file.mimetype)) {
      badRequest('Desteklenen formatlar: JPEG, PNG, WebP.')
    }

    // Buffer up to MAX_AVATAR_BYTES; reject larger uploads with a clear
    // 413. We deliberately don't trust `file.file.truncated` alone —
    // Fastify already enforces the global `bodyLimit` on the route's
    // multipart stream, so this is a belt-and-braces size check.
    const chunks = []
    let total = 0
    for await (const chunk of file.file) {
      total += chunk.length
      if (total > MAX_AVATAR_BYTES) {
        badRequest('Dosya 2 MB sınırını aşıyor.')
      }
      chunks.push(chunk)
    }
    const buffer = Buffer.concat(chunks, total)

    const ext = extForMime(file.mimetype)
    let url
    try {
      url = await saveAvatar(request.user.id, ext, buffer)
    } catch (err) {
      // Surface the real reason instead of "Beklenmeyen sunucu hatası".
      request.log.error({ err }, 'avatar save failed')
      throw new HttpError(500, `Avatar yüklenemedi: ${err.message}`, 'avatar_save_failed')
    }
    // Store the *relative* URL — the SPA knows its own VITE_API_BASE_URL
    // and rewrites the path at render time (see avatarSrc() in Settings).
    // An absolute URL would couple this column to whichever origin was
    // current at upload time, breaking when the cert/host rotates.
    await getPool().query(
      `UPDATE users SET avatar_url = $2, avatar_updated_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING avatar_url`,
      [request.user.id, url],
    )
    return { avatarUrl: url }
  })

  fastify.delete('/users/me/avatar', async (request) => {
    await attachUser(request)
    await deleteAvatar(request.user.id)
    await getPool().query(
      `UPDATE users SET avatar_url = NULL, avatar_updated_at = NULL, updated_at = NOW()
       WHERE id = $1`,
      [request.user.id],
    )
    return { ok: true }
  })

  // Public file stream for an arbitrary user. No auth — <img src> can't
  // carry X-User-Id. Returns 404 if no avatar is on file.
  fastify.get('/users/:id/avatar/file', async (request, reply) => {
    const { id } = request.params
    const { rows } = await getPool().query(
      `SELECT avatar_url FROM users WHERE id = $1 LIMIT 1`,
      [id],
    )
    if (!rows[0]?.avatar_url) return notFound('Avatar bulunamadı.')
    const file = await readAvatar(id, rows[0].avatar_url)
    if (!file) return notFound('Avatar dosyası eksik.')
    reply
      .header('Content-Type', file.mime)
      .header('Cache-Control', 'private, max-age=300')
      .send(file.buffer)
  })

  // Owner-only alias for the authenticated caller's avatar. Mirrors the
  // /users/:id route but resolves the id from the X-User-Id trust header.
  // Useful when a page holds a stale relative URL like `/api/users/me/avatar/file`.
  fastify.get('/users/me/avatar/file', async (request, reply) => {
    await attachUser(request)
    const id = request.user.id
    const { rows } = await getPool().query(
      `SELECT avatar_url FROM users WHERE id = $1 LIMIT 1`,
      [id],
    )
    if (!rows[0]?.avatar_url) return notFound('Avatar bulunamadı.')
    const file = await readAvatar(id, rows[0].avatar_url)
    if (!file) return notFound('Avatar dosyası eksik.')
    reply
      .header('Content-Type', file.mime)
      .header('Cache-Control', 'private, max-age=300')
      .send(file.buffer)
  })
}
