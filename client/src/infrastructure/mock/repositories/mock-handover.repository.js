import { httpClient } from '../../http/client.js'
import { mockHandovers, saveState } from '../store.js'
import { mockOrHttp } from '../helpers/mock-handler.js'
import { notFound } from '../helpers/errors.js'
import { uid } from '../helpers/id.js'

/**
 * Storage for Matbaa → Sales handover ("teslim") requests. A handover is raised
 * by the printer once a project reaches its final production stage, and closed
 * ("Alındı") by Sales — which moves the project to Satışta (handled in the
 * confirm-handover use case, since that crosses the project aggregate).
 */
export function createMockHandoverRepository() {
  return {
    listHandovers() {
      return mockOrHttp(
        () => mockHandovers.map((h) => ({ ...h })),
        async () => {
          const { data } = await httpClient.get('/handovers')
          return data
        },
      )
    },

    /** Synchronous store insert used inside the create-handover use case. */
    createHandover({ project, creator }) {
      const now = new Date().toISOString()
      const handover = {
        id: uid('hv-'),
        project_id: project.id,
        project_title: project.title,
        project_type: project.type,
        from_stage: project.stage,
        status: 'pending', // 'pending' | 'received'
        created_by_id: creator?.id ?? null,
        created_by_name: creator?.name ?? 'Matbaa',
        created_at: now,
        received_by_id: null,
        received_by_name: null,
        received_at: null,
      }
      mockHandovers.unshift(handover)
      saveState()
      return { ...handover }
    },

    findPendingByProject(projectId) {
      return mockHandovers.find((h) => h.project_id === projectId && h.status === 'pending') ?? null
    },

    getHandover(id) {
      const idx = mockHandovers.findIndex((h) => h.id === id)
      if (idx === -1) notFound('Teslim talebi bulunamadı.')
      return { idx, handover: mockHandovers[idx] }
    },

    persistHandover(idx, handover) {
      mockHandovers[idx] = handover
      saveState()
      return { ...handover }
    },
  }
}
