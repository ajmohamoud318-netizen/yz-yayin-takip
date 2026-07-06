import { httpClient } from '../../../infrastructure/http/client.js'
import { badRequest } from '../../../infrastructure/mock/helpers/errors.js'
import { mockOrHttp } from '../../../infrastructure/mock/helpers/mock-handler.js'

/**
 * Sales confirms receipt of the produced materials ("Alındı"). This closes the
 * handover and moves the linked project to Satışta — the only path to Satışta
 * in the current workflow.
 */
export function makeConfirmHandover({ handoverRepo, projectRepo }) {
  return function confirmHandover(id, { actor }) {
    return mockOrHttp(
      () => {
        // Only Sales (satis) confirms receipt ("Alındı") — this is the sole path
        // to Satışta. Data-layer gate, not just a UI restriction.
        if (actor?.role !== 'satis') {
          badRequest('Teslimi yalnızca satış ekibi onaylayabilir.')
        }
        const { idx, handover } = handoverRepo.getHandover(id)
        if (handover.status === 'received') badRequest('Bu teslim zaten onaylandı.')

        const now = new Date().toISOString()
        const updated = {
          ...handover,
          status: 'received',
          received_by_id: actor?.id ?? null,
          received_by_name: actor?.name ?? 'Satış',
          received_at: now,
        }
        handoverRepo.persistHandover(idx, updated)

        // Move the project to Satışta (recordOrderHistory flips the stage when
        // toStage differs from fromStage and appends a timeline entry).
        const p = projectRepo.findProjectById(handover.project_id)
        if (p && p.stage !== 'satista') {
          projectRepo.recordOrderHistory(handover.project_id, {
            orderId: handover.id,
            actorName: actor?.name ?? 'Satış',
            fromStage: p.stage,
            toStage: 'satista',
            note: `Teslim alındı — ${actor?.name ?? 'Satış'} onayladı, ürün satışa çıktı`,
          })
        }

        return { ...updated }
      },
      async () => {
        const { data } = await httpClient.post(`/handovers/${id}/confirm`)
        return data
      },
    )
  }
}
