import bcrypt from 'bcryptjs'
import { attachUser } from '../middleware/auth.js'
import { forbidden, unauthorized } from '../domain/errors.js'
import { getPool } from '../db/pool.js'

/**
 * Auth API.
 *
 * Real Google OAuth is intentionally not yet wired (per the roadmap in
 * AGENTS.md). Instead we expose:
 *   POST /api/auth/login     — body { email, password }, returns { token, user }
 *                              where `token` is the user's UUID (the client
 *                              stashes it and sends it back as X-User-Id).
 *   POST /api/auth/logout    — no-op for header auth.
 *   GET  /api/auth/me        — returns the attached user.
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
}
