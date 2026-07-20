import { httpClient } from '../../http/client.js'
import { mockUsers, saveState } from '../store.js'
import { mockOrHttp, mockOrHttpFast } from '../helpers/mock-handler.js'
import { unauthorized, forbidden } from '../helpers/errors.js'

const ALLOWED_AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_AVATAR_BYTES = 2 * 1024 * 1024

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

    /**
     * Mock-mode change-password: a no-op (mock passwords aren't
     * actually checked) but mirrors the HTTP contract so dev mode
     * works without the backend.
     */
    changePassword(currentPassword, newPassword) {
      return mockOrHttp(
        () => {
          if (!newPassword || newPassword.length < 8) {
            return Promise.reject(new Error('Yeni şifre en az 8 karakter olmalı.'))
          }
          return { ok: true }
        },
        async () => {
          const { data } = await httpClient.patch('/auth/change-password', {
            currentPassword,
            newPassword,
          })
          return data
        },
      )
    },

    /**
     * Mock-mode avatar upload: stash the file as a data URL on the
     * current mock user so refresh / reload still shows the photo.
     * Real disk storage lives on the Fastify server.
     */
    uploadAvatar(file) {
      return mockOrHttp(
        () => new Promise((resolve, reject) => {
          if (!file) return reject(new Error('Dosya bulunamadı.'))
          if (!ALLOWED_AVATAR_MIME.has(file.type)) {
            return reject(new Error('Desteklenen formatlar: JPEG, PNG, WebP.'))
          }
          if (file.size > MAX_AVATAR_BYTES) {
            return reject(new Error('Dosya 2 MB sınırını aşıyor.'))
          }
          // Pull the logged-in user id from the in-memory mock token.
          const auth = localStorage.getItem('yz_mock_token')
          if (!auth) return reject(new Error('Giriş yapmanız gerekiyor.'))
          const userId = auth.startsWith('mock-') ? auth.slice(5) : auth
          const user = mockUsers.find((u) => u.id === userId)
          if (!user) return reject(new Error('Kullanıcı bulunamadı.'))
          const reader = new FileReader()
          reader.onload = () => {
            user.avatar_url = reader.result
            user.avatar_updated_at = new Date().toISOString()
            saveState()
            resolve({ avatarUrl: reader.result })
          }
          reader.onerror = () => reject(new Error('Dosya okunamadı.'))
          reader.readAsDataURL(file)
        }),
        async () => {
          const fd = new FormData()
          fd.append('file', file)
          const { data } = await httpClient.put('/users/me/avatar', fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
          return data
        },
      )
    },

    deleteAvatar() {
      return mockOrHttp(
        () => {
          const auth = localStorage.getItem('yz_mock_token')
          if (!auth) return Promise.reject(new Error('Giriş yapmanız gerekiyor.'))
          const userId = auth.startsWith('mock-') ? auth.slice(5) : auth
          const user = mockUsers.find((u) => u.id === userId)
          if (!user) return Promise.reject(new Error('Kullanıcı bulunamadı.'))
          user.avatar_url = null
          user.avatar_updated_at = null
          saveState()
          return Promise.resolve({ ok: true })
        },
        async () => {
          const { data } = await httpClient.delete('/users/me/avatar')
          return data
        },
      )
    },
  }
}
