import { httpClient } from '../client.js'
import { PASS_KIND } from '../../../domain/index.js'
import { notFound, badRequest } from '../../shared/errors.js'
import { createProjectMapper } from '../../../application/mappers/project-mapper.js'

/**
 * HTTP project repo. Keeps a tiny in-memory `subscribers` set + cache
 * so cross-aggregate use cases (orders/handovers) can subscribe and
 * `findProjectById` works between list refreshes.
 */
export function createHttpProjectRepository(userRepo) {
  const cache = new Map()
  const subscribers = new Set()

  function onProjectChanged(project) {
    if (project?.id) cache.set(project.id, project)
    for (const fn of subscribers) {
      try { fn(project) } catch { /* swallow */ }
    }
  }

  function subscribe(fn) {
    subscribers.add(fn)
    return () => subscribers.delete(fn)
  }

  const { normalizeProjectPayload, buildProjectDetail } = createProjectMapper({
    findUserById: (id) => userRepo.findById(id),
    listUsers: () => userRepo.listRaw(),
  })

  async function refresh(id) {
    const { data } = await httpClient.get(`/projects/${id}`)
    cache.set(data.id, data)
    return data
  }

  return {
    buildProjectDetail,
    normalizeProjectPayload,
    onProjectChanged,
    subscribe,

    findProjectById(id) {
      return cache.get(id) ?? null
    },

    assignDesigners(projectId, assigneeIds = []) {
      // Server-side patch is what actually mutates the row. We update the
      // cache synchronously so the cross-aggregate use case (which asked us)
      // sees a consistent shape immediately. The async network call happens
      // out-of-band; errors there surface via the next list refresh.
      const before = cache.get(projectId)
      if (!before) return null
      const next = { ...before, assigned_to: assigneeIds[0] }
      cache.set(projectId, next)
      onProjectChanged(next)
      void httpClient.patch(`/projects/${projectId}`, { assigned_to: assigneeIds[0] })
        .then(({ data }) => { if (data) cache.set(projectId, data) })
        .catch(() => { /* ignore — list refresh will reconcile */ })
      return next
    },

    recordOrderHistory(projectId, entry) {
      // Server already inserted a row in the orders route. We treat this
      // as a no-op signal that emits to subscribers so the bell can refresh.
      const p = cache.get(projectId)
      if (p) onProjectChanged(p)
      return { ...p }
    },

    async listProjects() {
      const { data } = await httpClient.get('/projects')
      for (const p of data) cache.set(p.id, p)
      return data
    },
    async getProject(id) {
      if (!id) notFound('Proje bulunamadı.')
      return refresh(id)
    },
    async createProject(payload) {
      const flat = normalizeProjectPayload(payload)
      // Forward the mapper-normalised subtasks. The server's JSON schema
      // requires each subtask to carry `kind` (and total_pages /
      // total_stickers for the numeric kinds) — the mapper already
      // produces the right shape, so we just hand it over instead of
      // re-flattening to bare titles (which the schema rejects with 400).
      const subtasks = (flat.subtasks ?? []).map((s) => ({
        title: s.title,
        kind: s.kind ?? 'check',
        total_pages: s.total_pages ?? null,
        total_stickers: s.total_stickers ?? null,
      }))
      const { data } = await httpClient.post('/projects', {
        title: flat.title,
        type: flat.type,
        target_month: flat.target_month,
        pass_kind: flat.pass_kind ?? PASS_KIND.FIRST_EDITION,
        assigned_to: flat.assigned_to,
        subtasks,
      })
      cache.set(data.id, data)
      return data
    },
    async updateProject(id, patch) {
      // Mirror `createProject`: the NewProjectDialog sends the same
      // un-normalised payload for create AND edit, so we have to map it
      // through `normalizeProjectPayload` to translate the SPA's
      // convenience keys (`assignees`, `subtasks`, `pageCount`,
      // `stickerCount`, `subtaskAssignees`) into the server's real
      // columns / endpoints.
      //
      // Without this, the raw PATCH would only persist title / type /
      // target_month — silently dropping subtask changes. That was the
      // pre-bugfix behaviour too (the server then 500'd on the unknown
      // column), so this is a long-standing gap finally plugged.
      const cached = cache.get(id)
      const flat = normalizeProjectPayload(patch, cached)
      // 1) Save scalar project fields (title / type / target_month / assigned_to).
      const patchBody = {
        title: flat.title,
        type: flat.type,
        target_month: flat.target_month,
        assigned_to: flat.assigned_to,
      }
      const { data } = await httpClient.patch(`/projects/${id}`, patchBody)
      // 2) If the payload mentions subtasks, pageCount or stickerCount,
      //    sync them through the dedicated subtasks endpoint so the
      //    `subtasks` table actually reflects the change.
      const wantsSubtasks =
        Array.isArray(patch.subtasks) ||
        'pageCount' in patch ||
        'stickerCount' in patch ||
        'subtaskAssignees' in patch
      if (wantsSubtasks) {
        const subtasks = (flat.subtasks ?? []).map((s) => ({
          title: s.title,
          kind: s.kind ?? 'check',
          total_pages: s.total_pages ?? null,
          total_stickers: s.total_stickers ?? null,
          is_done: !!s.is_done,
        }))
        const putRes = await httpClient.put(`/projects/${id}/subtasks`, {
          subtasks,
        })
        cache.set(id, putRes.data.project ?? putRes.data)
        return putRes.data.project ?? putRes.data
      }
      cache.set(id, data)
      return data
    },
    async deleteProject(id) {
      await httpClient.delete(`/projects/${id}`)
      cache.delete(id)
      return { ok: true }
    },
    async advanceProject(id) {
      const { data } = await httpClient.post(`/projects/${id}/advance`, {})
      cache.set(id, data)
      return data
    },
    async approveProject(id) {
      const cached = cache.get(id)
      if (!cached) badRequest('Proje bilinmiyor — listeyi yenileyin.')
      const { data } = await httpClient.post(`/projects/${id}/approve`, { stage: cached.stage })
      cache.set(id, data)
      return data
    },
    async rejectProject(id, reason, revizeIds, target) {
      const cached = cache.get(id)
      if (!cached) badRequest('Proje bilinmiyor — listeyi yenileyin.')
      const { data } = await httpClient.post(`/projects/${id}/reject`, {
        stage: cached.stage, reason, reject_target: target, revizeIds,
      })
      cache.set(id, data)
      return data
    },
  }
}
