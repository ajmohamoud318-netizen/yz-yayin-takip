import { httpClient } from '../client.js'

/**
 * HTTP users repo. `findById` / `listRaw` are not exposed via the server
 * yet (next pass) so we provide a tiny in-memory cache populated from
 * `listUsers()`. The cross-aggregate use cases pull from this cache.
 */
export function createHttpUserRepository() {
  const cache = new Map()
  let raw = []

  async function refresh() {
    const { data } = await httpClient.get('/users')
    raw = data
    cache.clear()
    for (const u of data) cache.set(u.id, u)
    return data
  }

  function findById(id) {
    return cache.get(id) ?? null
  }

  function listRaw() {
    return raw
  }

  return {
    findById,
    listRaw,
    async listUsers() {
      return refresh()
    },
    async inviteUser(payload) {
      const { data } = await httpClient.post('/users/invite', payload)
      cache.set(data.id, data)
      raw = [...raw, data]
      return data
    },
    async setUserActive(id, isActive) {
      const path = isActive ? `/users/${id}/reactivate` : `/users/${id}/deactivate`
      const { data } = await httpClient.patch(path)
      cache.set(data.id, data)
      raw = raw.map((u) => (u.id === data.id ? data : u))
      return data
    },
    async setUserCapability(id, capability, value) {
      // Today only `can_approve_ozalit` is exposed via the API. Future
      // capabilities would route through the same endpoint with the
      // capability name in the request body.
      if (capability !== 'can_approve_ozalit') {
        throw new Error(`Bilinmeyen yetki: ${capability}`)
      }
      const { data } = await httpClient.patch(`/users/${id}/capabilities`, {
        canApproveOzalit: !!value,
      })
      cache.set(data.id, data)
      raw = raw.map((u) => (u.id === data.id ? data : u))
      return data
    },
    async deleteUser(id) {
      await httpClient.delete(`/users/${id}`)
      cache.delete(id)
      raw = raw.filter((u) => u.id !== id)
    },
  }
}
