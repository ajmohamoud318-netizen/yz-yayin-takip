import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'
import { attachUser, requireRole } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { badRequest, conflict, forbidden, notFound, HttpError } from '../domain/errors.js'
import { getPool } from '../db/pool.js'
import { reconcileOzalitApprovals } from '../services/project-repository.js'
import { schemas } from '../schemas/index.js'
import { createInvitation } from '../services/invitations.js'
import { dailyStatusSelect, workLogTodaySelect } from '../services/work-log.js'
import { sendMail, renderInviteEmail } from '../services/mail.js'
import {
  MAX_AVATAR_BYTES,
  avatarCacheHeaders,
  deleteAvatar,
  extForMime,
  isAllowedMime,
  readAvatar,
  saveAvatar,
  sniffImageMime,
} from '../services/avatars.js'

/**
 * Users API.
 *
 *  GET    /api/users
 *  POST   /api/users/invite
 *  PATCH  /api/users/:id/deactivate
 *  PATCH  /api/users/:id/reactivate
 *  DELETE /api/users/:id
 */

// True when there's at least one OTHER active team_leader besides `exceptId`.
// Used to protect the last active leader from deactivation/deletion.
async function hasOtherActiveLeader(exceptId) {
  const { rows } = await getPool().query(
    `SELECT 1 FROM users
      WHERE role = 'team_leader' AND is_active = TRUE AND id <> $1
      LIMIT 1`,
    [exceptId],
  )
  return rows.length > 0
}

// The founding leader is the team_leader with the earliest created_at row.
// Leaders are otherwise peers (any leader can deactivate/delete any other),
// but the founder is protected from being deactivated/deleted by anyone else.
async function isFoundingLeader(id) {
  const { rows } = await getPool().query(
    `SELECT id FROM users WHERE role = 'team_leader' ORDER BY created_at ASC LIMIT 1`,
  )
  return rows[0]?.id === id
}

export async function userRoutes(fastify) {
  // Every role needs *some* user list — it's the only source for assignee
  // name lookups on project cards (see client's project-mapper.js), so this
  // route can't be team_leader-gated outright without breaking those views
  // for designer/printer/satis. Instead we scope the columns: team_leader
  // gets the full roster (email, activity, daily status, work log) for the
  // /team and project-creation pages; everyone else gets just enough to
  // resolve an assignee's name, nothing that leaks PII or attendance.
  fastify.get('/users', async (request) => {
    await attachUser(request)
    // `avatar_url` + `avatar_updated_at` ship with BOTH column sets. The
    // avatar file route is already public-ish (an <img> can't send
    // X-User-Id), so these leak nothing the roster doesn't already, and
    // without them every UserAvatar fed by this list — /team cards, the
    // assignee pickers — renders initials forever no matter what the
    // person uploads. `avatar_updated_at` is what the SPA turns into the
    // `?v=` cache-buster (see avatarSrc()), so it has to travel with the
    // URL or a replaced photo stays stale in the browser cache.
    if (request.user.role !== 'team_leader') {
      const { rows } = await getPool().query(
        `SELECT u.id, u.name, u.role, u.is_active,
                u.avatar_url, u.avatar_updated_at
           FROM users u
          ORDER BY u.created_at`,
      )
      return rows
    }
    // `work_log_today` is the full list of today's entries per user — the
    // /team cards render it directly, so the leader gets everyone's day in
    // the one request the page already makes. `daily_status` is the newest
    // of those entries, kept for the callers that only want one line.
    const { rows } = await getPool().query(
      `SELECT u.id, u.name, u.email, u.role, u.is_active,
              u.invited_at, u.joined_at, u.created_at,
              u.avatar_url, u.avatar_updated_at,
              ${dailyStatusSelect('u')},
              ${workLogTodaySelect('u')}
         FROM users u
        ORDER BY u.created_at`,
    )
    return rows
  })

  fastify.post(
    '/users/invite',
    {
      schema: schemas.usersInvite,
      // Throttle invite creation per IP. A compromised leader session (or a
      // buggy client loop) shouldn't be able to fire off unbounded invite
      // emails and burn SMTP quota. 30 per hour is well above any real use.
      preHandler: rateLimit({
        keys: [(req) => `users-invite:ip:${req.ip}`],
        limit: 30,
        windowMs: 60 * 60_000,
        message: 'Çok fazla davet isteği. Lütfen biraz sonra tekrar deneyin.',
      }),
    },
    async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const { name, email, role } = request.body
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
          `UPDATE users
              SET is_active = TRUE,
                  invited_at = NOW(),
                  name = $2,
                  role = $3
            WHERE id = $1
        RETURNING id, name, email, role, is_active,
                  invited_at, joined_at, created_at`,
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
       RETURNING id, name, email, role, is_active,
                 invited_at, joined_at, created_at`,
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

  fastify.patch('/users/:id/deactivate', { schema: schemas.userIdParams }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const { id } = request.params
    if (id === request.user.id) forbidden('Kendinizi devre dışı bırakamazsınız.')
    // Never leave the team without an active leader: block deactivating the
    // last active team_leader (otherwise nobody can invite/manage/reactivate).
    const target = await getPool().query('SELECT role FROM users WHERE id = $1', [id])
    if (!target.rows[0]) notFound('Kullanıcı bulunamadı.')
    if (target.rows[0].role === 'team_leader' && !(await hasOtherActiveLeader(id))) {
      forbidden('Son aktif takım liderini devre dışı bırakamazsınız.')
    }
    if (target.rows[0].role === 'team_leader' && (await isFoundingLeader(id))) {
      forbidden('Kurucu takım liderini devre dışı bırakamazsınız.')
    }
    const { rows } = await getPool().query(
      `UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1
       RETURNING id, name, email, role, is_active`,
      [id],
    )
    if (!rows[0]) notFound('Kullanıcı bulunamadı.')
    // Deactivating a leader shrinks the "every active leader must approve"
    // set. Advance any pending ozalit that this now completes so it doesn't
    // stall waiting on the person who just lost access.
    if (rows[0].role === 'team_leader') {
      try {
        await reconcileOzalitApprovals(request.user)
      } catch (err) {
        request.log.warn({ err, userId: id }, 'ozalit reconcile after deactivate failed; continuing')
      }
    }
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
    // Same protection as deactivate: don't delete the last active team leader.
    const target = await getPool().query('SELECT role FROM users WHERE id = $1', [id])
    if (!target.rows[0]) return notFound('Kullanıcı bulunamadı.')
    if (target.rows[0].role === 'team_leader' && !(await hasOtherActiveLeader(id))) {
      forbidden('Son aktif takım liderini silemezsiniz.')
    }
    if (target.rows[0].role === 'team_leader' && (await isFoundingLeader(id))) {
      forbidden('Kurucu takım liderini silemezsiniz.')
    }
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

    // Content sniff — the declared multipart mimetype is attacker-controlled,
    // so verify the actual file bytes are a real image of an allowed type and
    // match what was declared. Blocks a renamed script/HTML/SVG smuggled in
    // under an image content-type.
    const sniffed = sniffImageMime(buffer)
    if (!sniffed || sniffed !== file.mimetype) {
      badRequest('Dosya içeriği geçerli bir görüntü değil (JPEG, PNG veya WebP).')
    }

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
    const { rows } = await getPool().query(
      `UPDATE users SET avatar_url = $2, avatar_updated_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING avatar_url, avatar_updated_at`,
      [request.user.id, url],
    )
    // Hand back the server's own stamp: it's what every other client will
    // see in GET /users, so the uploader's `?v=` matches theirs instead of
    // depending on how well the phone's clock is set.
    return { avatarUrl: url, avatarUpdatedAt: rows[0]?.avatar_updated_at ?? null }
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

  /**
   * Shared body for both avatar file routes. Cache policy — and the
   * reasoning behind it — lives in avatarCacheHeaders().
   */
  async function sendAvatar(request, reply, id) {
    const { rows } = await getPool().query(
      `SELECT avatar_url, avatar_updated_at FROM users WHERE id = $1 LIMIT 1`,
      [id],
    )
    if (!rows[0]?.avatar_url) return notFound('Avatar bulunamadı.')

    const { cacheControl, etag } = avatarCacheHeaders({
      versioned: !!request.query?.v,
      userId: id,
      updatedAt: rows[0].avatar_updated_at,
    })

    if (request.headers['if-none-match'] === etag) {
      // Unchanged since the browser last fetched it — skip the disk read
      // and the body entirely.
      return reply.header('Cache-Control', cacheControl).header('ETag', etag).code(304).send()
    }

    // Headers go on only once we know we have bytes. Setting them earlier
    // would let a `?v=`-immutable Cache-Control ride out on the 404 below,
    // and that 404 is a *transient* condition (see avatars.js on volumes
    // that mount late) — pinning it in the browser for a year would leave
    // the person permanently without an avatar.
    const file = await readAvatar(id, rows[0].avatar_url)
    if (!file) return notFound('Avatar dosyası eksik.')
    reply
      .header('Content-Type', file.mime)
      .header('Cache-Control', cacheControl)
      .header('ETag', etag)
      .send(file.buffer)
  }

  // Public file stream for an arbitrary user. No auth — <img src> can't
  // carry X-User-Id. Returns 404 if no avatar is on file.
  fastify.get('/users/:id/avatar/file', async (request, reply) =>
    sendAvatar(request, reply, request.params.id),
  )

  // Owner-only alias for the authenticated caller's avatar. Mirrors the
  // /users/:id route but resolves the id from the X-User-Id trust header.
  // Useful when a page holds a stale relative URL like `/api/users/me/avatar/file`.
  fastify.get('/users/me/avatar/file', async (request, reply) => {
    await attachUser(request)
    return sendAvatar(request, reply, request.user.id)
  })
}
