import { httpClient } from '../client.js'

/**
 * Auth repo when the real backend is wired in.
 *
 * Server returns { token, user } where `token` is the user's UUID — we
 * stash it client-side as an `X-User-Id` header. Real OAuth is the
 * next pass; this swap keeps every existing UI hook working.
 */
export function createHttpAuthRepository() {
  return {
    async login(email, password) {
      const { data } = await httpClient.post('/auth/login', { email, password })
      return data
    },
    async logout() {
      try {
        await httpClient.post('/auth/logout')
      } catch {
        /* ignore network failures on logout */
      }
      return { ok: true }
    },
  }
}
