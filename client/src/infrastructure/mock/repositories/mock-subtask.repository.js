import { httpClient } from '../../http/client.js'
import { subtaskProgress, STAGES_REQUIRING_FULL_PROGRESS } from '../../../domain/index.js'
import { mockProjects, saveState } from '../store.js'
import { mockOrHttp } from '../helpers/mock-handler.js'
import { notFound, badRequest } from '../helpers/errors.js'

export function createMockSubtaskRepository() {
  function findProjectBySubtaskId(subtaskId) {
    return mockProjects.findIndex((p) => (p.subtasks ?? []).some((s) => s.id === subtaskId))
  }

  // Ozalit onward, a project has already cleared the 100% gate — its design is
  // frozen. Checking a subtask off (or on) here used to recompute progress and
  // silently drop a finished project back to e.g. 50% while it kept sitting at
  // "Üretime Hazır". Reject the edit at these stages.
  function assertDesignEditable(project) {
    if (STAGES_REQUIRING_FULL_PROGRESS.has(project.stage)) {
      badRequest('Proje üretim aşamasına geçtiği için alt görevleri değiştirilemez.')
    }
  }

  // Structural edits (leader re-saving a project, metadata patches) may still
  // touch a locked project — but its progress must stay pinned at 100%, never
  // recomputed downward.
  function progressFor(project, subs) {
    return STAGES_REQUIRING_FULL_PROGRESS.has(project.stage) ? 100 : subtaskProgress(subs)
  }

  return {
    toggleSubtask(projectId, subtaskId, isDone) {
      return mockOrHttp(
        () => {
          const idx = mockProjects.findIndex((p) => p.id === projectId)
          if (idx === -1) notFound('Proje bulunamadı.')
          const p = mockProjects[idx]
          assertDesignEditable(p)
          const subs = (p.subtasks ?? []).map((s) =>
            s.id === subtaskId ? { ...s, is_done: isDone, done_at: isDone ? new Date().toISOString() : null } : s,
          )
          const progress = progressFor(p, subs)
          mockProjects[idx] = { ...p, subtasks: subs, progress }
          saveState()
          return { ...mockProjects[idx] }
        },
        async () => {
          const { data } = await httpClient.patch(`/subtasks/${subtaskId}`, { is_done: isDone })
          return data
        },
      )
    },

    setSubtaskDone(subtaskId, isDone) {
      return mockOrHttp(
        () => {
          const idx = findProjectBySubtaskId(subtaskId)
          if (idx === -1) notFound('Alt görev bulunamadı.')
          const p = mockProjects[idx]
          assertDesignEditable(p)
          const subs = p.subtasks.map((s) =>
            s.id === subtaskId
              ? { ...s, is_done: isDone, done_at: isDone ? new Date().toISOString() : null }
              : s,
          )
          mockProjects[idx] = { ...p, subtasks: subs, progress: progressFor(p, subs) }
          saveState()
          return { project: { ...mockProjects[idx] } }
        },
        async () => {
          const { data } = await httpClient.patch(`/subtasks/${subtaskId}`, { is_done: isDone })
          return data
        },
      )
    },

    setSubtaskPages(subtaskId, pagesDone) {
      return mockOrHttp(
        () => {
          const idx = findProjectBySubtaskId(subtaskId)
          if (idx === -1) notFound('Alt görev bulunamadı.')
          const p = mockProjects[idx]
          assertDesignEditable(p)
          const subs = p.subtasks.map((s) => {
            if (s.id !== subtaskId) return s
            // A pages subtask is only "done" once its page count is reached — and
            // only if a positive total exists. Guard the 0/undefined case so an
            // untargeted page goal doesn't mark itself done at pages_done = 0.
            const total = s.total_pages ?? 0
            return { ...s, pages_done: pagesDone, is_done: total > 0 && pagesDone >= total }
          })
          mockProjects[idx] = { ...p, subtasks: subs, progress: progressFor(p, subs) }
          saveState()
          return { project: { ...mockProjects[idx] } }
        },
        async () => {
          const { data } = await httpClient.patch(`/subtasks/${subtaskId}`, { pages_done: pagesDone })
          return data
        },
      )
    },

    addSubtaskUpdate(subtaskId, { note, by = null, by_name = '—' }) {
      return mockOrHttp(
        () => {
          const idx = findProjectBySubtaskId(subtaskId)
          if (idx === -1) notFound('Alt görev bulunamadı.')
          const entry = {
            id: `su-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            note,
            by,
            by_name,
            at: new Date().toISOString(),
          }
          const p = mockProjects[idx]
          const subs = p.subtasks.map((s) =>
            s.id === subtaskId ? { ...s, updates: [...(s.updates ?? []), entry] } : s,
          )
          mockProjects[idx] = { ...p, subtasks: subs }
          saveState()
          return { project: { ...mockProjects[idx] }, entry }
        },
        async () => {
          const { data } = await httpClient.post(`/subtasks/${subtaskId}/updates`, { note })
          return data
        },
      )
    },

    updateSubtask(subtaskId, patch) {
      return mockOrHttp(
        () => {
          const idx = findProjectBySubtaskId(subtaskId)
          if (idx === -1) notFound('Alt görev bulunamadı.')
          const p = mockProjects[idx]
          const subs = p.subtasks.map((s) => (s.id === subtaskId ? { ...s, ...patch } : s))
          mockProjects[idx] = { ...p, subtasks: subs, progress: progressFor(p, subs) }
          saveState()
          return { project: { ...mockProjects[idx] } }
        },
        async () => {
          const { data } = await httpClient.patch(`/subtasks/${subtaskId}`, patch)
          return data
        },
      )
    },

    saveProjectSubtasks(projectId, subtasks) {
      return mockOrHttp(
        () => {
          const idx = mockProjects.findIndex((p) => p.id === projectId)
          if (idx === -1) notFound('Proje bulunamadı.')
          const subs = Array.isArray(subtasks) ? subtasks : []
          const p = mockProjects[idx]
          mockProjects[idx] = { ...p, subtasks: subs, progress: progressFor(p, subs) }
          saveState()
          return { project: { ...mockProjects[idx] } }
        },
        async () => {
          const { data } = await httpClient.put(`/projects/${projectId}/subtasks`, { subtasks })
          return data
        },
      )
    },
  }
}
