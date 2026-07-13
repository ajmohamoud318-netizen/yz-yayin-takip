import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'
import { attachUser, requireRole } from '../middleware/auth.js'
import { badRequest, conflict, forbidden, notFound } from '../domain/errors.js'
import { getPool } from '../db/pool.js'

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
    const existing = await getPool().query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()])
    if (existing.rowCount > 0) conflict('Bu e-posta zaten kayıtlı.')
    // Initial password = demo string. The user is expected to set their own
    // password via the /accept-invite link (out-of-scope UI for this pass).
    const passwordHash = bcrypt.hashSync('123456', 8)
    const { rows } = await getPool().query(
      `INSERT INTO users (name, email, password, role, is_active, invited_at)
       VALUES ($1,$2,$3,$4,TRUE,NOW())
       RETURNING id, name, email, role, is_active, invited_at, joined_at, created_at`,
      [name.trim(), email.trim().toLowerCase(), passwordHash, role],
    )
    const user = rows[0]
    // Issue an invitation record so the accept-invite route can verify a
    // token in a future pass. Token is just nanoid for now — no email yet.
    const token = nanoid(24)
    await getPool().query(
      `INSERT INTO invitations (user_id, token, expires_at)
       VALUES ($1,$2, NOW() + INTERVAL '7 days')`,
      [user.id, token],
    )
    return user
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
