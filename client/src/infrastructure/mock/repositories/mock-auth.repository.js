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
  }
}
