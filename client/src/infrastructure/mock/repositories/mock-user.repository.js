import { httpClient } from '../../http/client.js'
import { mockUsers, saveState } from '../store.js'
import { mockOrHttp } from '../helpers/mock-handler.js'
import { notFound, conflict } from '../helpers/errors.js'
import { uid } from '../helpers/id.js'

export function createMockUserRepository() {
  function findById(id) {
    return mockUsers.find((u) => u.id === id)
  }

  function listRaw() {
    return mockUsers
  }

  function stripPassword(user) {
    const { password: _pw, ...safe } = user
    return safe
  }

  return {
    findById,
    listRaw,

    listUsers() {
      return mockOrHttp(
        () => mockUsers.map(stripPassword),
        async () => {
          const { data } = await httpClient.get('/users')
          return data
        },
      )
    },

    inviteUser({ name, email, role }) {
      return mockOrHttp(
        () => {
          const existing = mockUsers.find((u) => u.email.toLowerCase() === email.toLowerCase().trim())
          if (existing) conflict('Bu e-posta zaten kayıtlı.')
          const created = {
            id: uid('u-'),
            name: name.trim(),
            email: email.trim().toLowerCase(),
            password: '123456',
            role,
            is_active: true,
            invited_at: new Date().toISOString(),
            joined_at: null,
          }
          mockUsers.push(created)
          saveState()
          return stripPassword(created)
        },
        async () => {
          const { data } = await httpClient.post('/users/invite', { name, email, role })
          return data
        },
      )
    },

    setUserActive(id, isActive) {
      return mockOrHttp(
        () => {
          const idx = mockUsers.findIndex((u) => u.id === id)
          if (idx === -1) notFound('Kullanıcı bulunamadı.')
          mockUsers[idx] = { ...mockUsers[idx], is_active: isActive }
          saveState()
          return stripPassword(mockUsers[idx])
        },
        async () => {
          const path = isActive ? `/users/${id}/reactivate` : `/users/${id}/deactivate`
          const { data } = await httpClient.patch(path)
          return data
        },
      )
    },

    deleteUser(id) {
      return mockOrHttp(
        () => {
          const idx = mockUsers.findIndex((u) => u.id === id)
          if (idx === -1) notFound('Kullanıcı bulunamadı.')
          mockUsers.splice(idx, 1)
          saveState()
          return null
        },
        async () => {
          await httpClient.delete(`/users/${id}`)
          return null
        },
      )
    },
  }
}
