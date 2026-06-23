import { httpClient } from '../../http/client.js'
import { subtaskProgress } from '../../../domain/index.js'
import { mockProjects, saveState } from '../store.js'
import { mockOrHttp } from '../helpers/mock-handler.js'
import { notFound } from '../helpers/errors.js'

export function createMockSubtaskRepository() {
  function findProjectBySubtaskId(subtaskId) {
    return mockProjects.findIndex((p) => (p.subtasks ?? []).some((s) => s.id === subtaskId))
  }

  return {
    toggleSubtask(projectId, subtaskId, isDone) {
      return mockOrHttp(
        () => {
          const idx = mockProjects.findIndex((p) => p.id === projectId)
          if (idx === -1) notFound('Proje bulunamadı.')
          const p = mockProjects[idx]
          const subs = (p.subtasks ?? []).map((s) =>
            s.id === subtaskId ? { ...s, is_done: isDone, done_at: isDone ? new Date().toISOString() : null } : s,
          )
          const total = subs.length || 1
          const done = subs.filter((s) => s.is_done).length
          const progress = Math.round((done / total) * 100)
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
          const subs = p.subtasks.map((s) =>
            s.id === subtaskId
              ? { ...s, is_done: isDone, done_at: isDone ? new Date().toISOString() : null }
              : s,
          )
          mockProjects[idx] = { ...p, subtasks: subs, progress: subtaskProgress(subs) }
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
          const subs = p.subtasks.map((s) =>
            s.id === subtaskId
              ? { ...s, pages_done: pagesDone, is_done: pagesDone >= (s.total_pages ?? 0) }
              : s,
          )
          mockProjects[idx] = { ...p, subtasks: subs, progress: subtaskProgress(subs) }
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
          mockProjects[idx] = { ...p, subtasks: subs, progress: subtaskProgress(subs) }
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
          mockProjects[idx] = { ...mockProjects[idx], subtasks: subs, progress: subtaskProgress(subs) }
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
