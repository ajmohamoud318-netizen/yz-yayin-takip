import { httpClient } from '../../http/client.js'
import { mockUsers } from '../store.js'
import { mockOrHttp, mockOrHttpFast } from '../helpers/mock-handler.js'
import { unauthorized, forbidden } from '../helpers/errors.js'

export function createMockAuthRepository() {
  return {
    login(email, password) {
      return mockOrHttp(
        () => {
          const user = mockUsers.find(
            (u) => u.email.toLowerCase() === String(email).toLowerCase().trim(),
          )
          if (!user || user.password !== password) unauthorized('E-posta veya şifre hatalı.')
          if (!user.is_active) forbidden('Hesabınız devre dışı bırakılmış.')
          const { password: _pw, ...safe } = user
          return { token: `mock-${user.id}`, user: safe }
        },
        async () => {
          const { data } = await httpClient.post('/auth/login', { email, password })
          return data
        },
      )
    },

    logout() {
      return mockOrHttpFast(
        () => ({ ok: true }),
        async () => {
          await httpClient.post('/auth/logout')
        },
      )
    },

    /**
     * Mock-mode "invite preview": returns the matching user (if any) so
     * the AcceptInvite page can render a friendly header. Accepts any
     * non-empty token and treats it as valid in mock mode.
     */
    previewInvite(token) {
      return mockOrHttp(
        () => {
          if (!token) return Promise.reject(new Error('Davet token\'ı zorunlu.'))
          // In mock mode there is no real invitations table; return a
          // generic preview so the form renders.
          return {
            name: 'Davetli Kullanıcı',
            email: 'davetli@ornek.com',
            role: 'designer',
            expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          }
        },
        async () => {
          const { data } = await httpClient.get('/auth/invite-preview', {
            params: { token },
          })
          return data
        },
      )
    },

    /**
     * Mock-mode accept-invite: store the password in the localStorage
     * mock user, and return a mock token so the user is "logged in".
     */
    acceptInvite(token, password) {
      return mockOrHttp(
        () => {
          if (!token) return Promise.reject(new Error('Davet token\'ı zorunlu.'))
          if (!password || password.length < 8) {
            return Promise.reject(new Error('Şifre en az 8 karakter olmalı.'))
          }
          // Pick the first active mock user — the SPA was built against
          // seeded fixtures, so we accept against whoever exists.
          const user = mockUsers.find((u) => u.is_active) ?? mockUsers[0]
          if (!user) return Promise.reject(new Error('Davet bulunamadı.'))
          const { password: _pw, ...safe } = user
          return { token: `mock-${user.id}`, user: safe }
        },
        async () => {
          const { data } = await httpClient.post('/auth/accept-invite', {
            token,
            password,
          })
          return data
        },
      )
    },

    /**
     * Mock-mode forgot-password: always resolves with { ok: true } so
     * the UX mirrors the real server. Useful for previewing the page
     * without spinning up the backend.
     */
    forgotPassword(email) {
      return mockOrHttp(
        () => Promise.resolve({ ok: true }),
        async () => {
          const { data } = await httpClient.post('/auth/forgot-password', { email })
          return data
        },
      )
    },

    /**
     * Mock-mode reset-password: just logs the user in as the first
     * active mock user. Real verification / bcrypt happens in HTTP mode.
     */
    resetPassword(token, password) {
      return mockOrHttp(
        () => {
          if (!password || password.length < 8) {
            return Promise.reject(new Error('Şifre en az 8 karakter olmalı.'))
          }
          const user = mockUsers.find((u) => u.is_active) ?? mockUsers[0]
          if (!user) return Promise.reject(new Error('Sıfırlama bağlantısı geçersiz.'))
          const { password: _pw, ...safe } = user
          return { token: `mock-${user.id}`, user: safe }
        },
        async () => {
          const { data } = await httpClient.post('/auth/reset-password', {
            token,
            password,
          })
          return data
        },
      )
    },
  }
}
