import { httpClient, getCurrentUserId } from '../../http/client.js'
import {
  STAGE_PIPELINE,
  subtaskProgress,
  assertCanEnterProduction,
} from '../../../domain/index.js'
import { mockProjects, saveState } from '../store.js'
import { mockOrHttp } from '../helpers/mock-handler.js'
import { notFound } from '../helpers/errors.js'
import { createProjectMapper } from '../../../application/mappers/project-mapper.js'

export function createMockProjectRepository(userRepo) {
  const { normalizeProjectPayload, buildProjectDetail } = createProjectMapper({
    findUserById: (id) => userRepo.findById(id),
    listUsers: () => userRepo.listRaw(),
  })

  function findIndex(id) {
    return mockProjects.findIndex((p) => p.id === id)
  }

  function currentActorName() {
    const user = userRepo.findById(getCurrentUserId())
    return user?.name ?? 'Bilinmeyen'
  }

  function appendHistory(p, entry) {
    return [...(p.history ?? []), entry]
  }

  return {
    buildProjectDetail,
    normalizeProjectPayload,

    listProjects() {
      return mockOrHttp(
        () =>
          mockProjects.map((p) => {
            if (Array.isArray(p.assignees) && p.assignees.length > 0) return { ...p }
            const resolved = userRepo
              .listRaw()
              .filter((u) => u.id === p.assigned_to)
              .map((u) => ({ id: u.id, name: u.name }))
            return { ...p, assignees: resolved }
          }),
        async () => {
          const { data } = await httpClient.get('/projects')
          return data
        },
      )
    },

    getProject(id) {
      return mockOrHttp(
        () => {
          const idx = findIndex(id)
          if (idx === -1) notFound('Proje bulunamadı.')
          const detail = buildProjectDetail(mockProjects[idx])
          mockProjects[idx] = {
            ...mockProjects[idx],
            assignees: detail.assignees,
            assigned_name: detail.assigned_name ?? mockProjects[idx].assigned_name,
            subtasks: detail.subtasks,
            history: mockProjects[idx].history ?? detail.history,
          }
          saveState()
          return detail
        },
        async () => {
          const { data } = await httpClient.get(`/projects/${id}`)
          return data
        },
      )
    },

    createProject(payload) {
      return mockOrHttp(
        () => {
          const normalized = normalizeProjectPayload(payload)
          const projectId = `p-${Date.now()}`
          const now = new Date().toISOString()
          const created = {
            id: projectId,
            stage: 'tasarim',
            demo_attempt: 0,
            created_at: now,
            updated_at: now,
            ...normalized,
            history: [
              {
                id: `${projectId}-hc`,
                action: 'create',
                from_stage: null,
                to_stage: 'tasarim',
                done_by_name: 'Ayşenur Kanak',
                created_at: now,
                note: `${normalized.assigned_name} atandı`,
              },
            ],
          }
          mockProjects.push(created)
          saveState()
          return created
        },
        async () => {
          const { data } = await httpClient.post('/projects', payload)
          return data
        },
      )
    },

    updateProject(id, patch) {
      return mockOrHttp(
        () => {
          const idx = findIndex(id)
          if (idx === -1) notFound('Proje bulunamadı.')
          const normalized = normalizeProjectPayload(patch, mockProjects[idx])
          mockProjects[idx] = { ...mockProjects[idx], ...normalized }
          saveState()
          return { ...mockProjects[idx] }
        },
        async () => {
          const { data } = await httpClient.patch(`/projects/${id}`, patch)
          return data
        },
      )
    },

    deleteProject(id) {
      return mockOrHttp(
        () => {
          const idx = findIndex(id)
          if (idx >= 0) {
            mockProjects.splice(idx, 1)
            saveState()
          }
          return { ok: true }
        },
        async () => {
          await httpClient.delete(`/projects/${id}`)
        },
      )
    },

    advanceProject(id) {
      return mockOrHttp(
        () => {
          const idx = findIndex(id)
          if (idx === -1) notFound('Proje bulunamadı.')
          const p = mockProjects[idx]
          const pipeline = p.type === 'CIN' ? STAGE_PIPELINE.CIN : STAGE_PIPELINE.TR
          const i = pipeline.indexOf(p.stage)
          if (i === -1 || i === pipeline.length - 1) return { ...p }
          const next = pipeline[i + 1]
          assertCanEnterProduction(next, p.progress)
          const now = new Date().toISOString()
          const entry = {
            id: `${p.id}-h${Date.now()}`,
            action: 'advance',
            from_stage: p.stage,
            to_stage: next,
            done_by_name: currentActorName(),
            created_at: now,
          }
          mockProjects[idx] = { ...p, stage: next, updated_at: now, history: appendHistory(p, entry) }
          saveState()
          return { ...mockProjects[idx] }
        },
        async () => {
          const { data } = await httpClient.post(`/projects/${id}/advance`)
          return data
        },
      )
    },

    approveStage(id, stage) {
      return mockOrHttp(
        () => {
          const idx = findIndex(id)
          if (idx >= 0) {
            const p = mockProjects[idx]
            const now = new Date().toISOString()
            const entry = {
              id: `${p.id}-h${Date.now()}`,
              action: 'approve',
              from_stage: p.stage,
              to_stage: stage,
              done_by_name: currentActorName(),
              created_at: now,
            }
            mockProjects[idx] = { ...p, stage, updated_at: now, history: appendHistory(p, entry) }
            saveState()
          }
          return { ...mockProjects[idx] }
        },
        async () => {
          const { data } = await httpClient.post(`/projects/${id}/approve`, { stage })
          return data
        },
      )
    },

    rejectStage(id, stage, reason) {
      return mockOrHttp(
        () => {
          const idx = findIndex(id)
          if (idx >= 0) {
            const p = mockProjects[idx]
            const now = new Date().toISOString()
            const entry = {
              id: `${p.id}-h${Date.now()}`,
              action: 'reject',
              from_stage: p.stage,
              to_stage: 'tasarim',
              done_by_name: currentActorName(),
              reason,
              created_at: now,
            }
            mockProjects[idx] = {
              ...p,
              stage: 'tasarim',
              demo_attempt: (p.demo_attempt ?? 0) + 1,
              updated_at: now,
              history: appendHistory(p, entry),
            }
            saveState()
          }
          return { ...mockProjects[idx] }
        },
        async () => {
          const { data } = await httpClient.post(`/projects/${id}/reject`, { stage, reason })
          return data
        },
      )
    },

    approveProject(id) {
      return mockOrHttp(
        () => {
          const idx = findIndex(id)
          if (idx === -1) notFound('Proje bulunamadı.')
          const p = mockProjects[idx]
          const pipeline = p.type === 'CIN' ? STAGE_PIPELINE.CIN : STAGE_PIPELINE.TR
          const i = pipeline.indexOf(p.stage)
          if (i === -1 || i === pipeline.length - 1) return { ...p }
          const next = pipeline[i + 1]
          assertCanEnterProduction(next, p.progress)
          const now = new Date().toISOString()
          const entry = {
            id: `${p.id}-h${Date.now()}`,
            action: 'approve',
            from_stage: p.stage,
            to_stage: next,
            done_by_name: currentActorName(),
            created_at: now,
          }
          mockProjects[idx] = { ...p, stage: next, updated_at: now, history: appendHistory(p, entry) }
          saveState()
          return { ...mockProjects[idx] }
        },
        async () => {
          const { data } = await httpClient.post(`/projects/${id}/approve`)
          return data
        },
      )
    },

    rejectProject(id, reason, revizeIds = []) {
      return mockOrHttp(
        () => {
          const idx = findIndex(id)
          if (idx === -1) notFound('Proje bulunamadı.')
          const p = mockProjects[idx]
          const isOzalit = p.stage === 'ozalit_onay'
          const nowIso = new Date().toISOString()
          const selected = new Set(revizeIds)
          const baseSubs = (p.subtasks ?? []).filter((s) => s.kind !== 'revize')
          const updatedSubs = baseSubs.map((s) => {
            const needs = selected.has(s.id)
            if (s.kind === 'pages') {
              return needs
                ? { ...s, needs_revize: true, pages_done: 0, is_done: false }
                : { ...s, needs_revize: false, pages_done: s.total_pages ?? s.pages_done ?? 0, is_done: true }
            }
            return needs
              ? { ...s, needs_revize: true, is_done: false, done_at: null }
              : { ...s, needs_revize: false, is_done: true, done_at: s.done_at ?? nowIso }
          })
          const entry = {
            id: `${p.id}-h${Date.now()}`,
            action: 'reject',
            from_stage: p.stage,
            to_stage: 'tasarim',
            done_by_name: currentActorName(),
            reason,
            created_at: nowIso,
          }
          mockProjects[idx] = {
            ...p,
            stage: 'tasarim',
            demo_attempt: isOzalit ? (p.demo_attempt ?? 0) : (p.demo_attempt ?? 0) + 1,
            ozalit_attempt: isOzalit ? (p.ozalit_attempt ?? 0) + 1 : (p.ozalit_attempt ?? 0),
            last_reject_reason: reason,
            last_reject_type: isOzalit ? 'ozalit' : 'demo',
            subtasks: updatedSubs,
            progress: subtaskProgress(updatedSubs),
            updated_at: nowIso,
            history: appendHistory(p, entry),
          }
          saveState()
          return { ...mockProjects[idx] }
        },
        async () => {
          const { data } = await httpClient.post(`/projects/${id}/reject`, { reason, revize_ids: revizeIds })
          return data
        },
      )
    },

    requestDemo(projectId) {
      return mockOrHttp(
        () => {
          const idx = findIndex(projectId)
          if (idx === -1) notFound('Proje bulunamadı.')
          mockProjects[idx] = {
            ...mockProjects[idx],
            demo_requested: true,
            demo_requested_at: new Date().toISOString(),
          }
          saveState()
          return { ...mockProjects[idx] }
        },
        async () => {
          const { data } = await httpClient.post(`/projects/${projectId}/request-demo`)
          return data
        },
      )
    },

    findProjectById(id) {
      const idx = findIndex(id)
      return idx === -1 ? null : mockProjects[idx]
    },

    recordOrderHistory(projectId, { orderId, actorName, fromStage, toStage, note }) {
      const pidx = findIndex(projectId)
      if (pidx === -1) return
      const p = mockProjects[pidx]
      if (!p.history) {
        const detail = buildProjectDetail(p)
        mockProjects[pidx] = { ...mockProjects[pidx], history: detail.history }
      }
      mockProjects[pidx] = {
        ...mockProjects[pidx],
        ...(toStage !== fromStage ? { stage: toStage } : {}),
        history: [
          ...(mockProjects[pidx].history ?? []),
          {
            id: `oh-proj-${Date.now()}`,
            action: 'order',
            order_id: orderId,
            from_stage: fromStage,
            to_stage: toStage,
            done_by_name: actorName,
            created_at: new Date().toISOString(),
            note,
          },
        ],
      }
      saveState()
    },
  }
}
