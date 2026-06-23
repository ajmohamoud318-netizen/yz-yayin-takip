import { ORDER_STEP_LABELS, ORDER_STEP_NEXT } from '../../../domain/index.js'
import { httpClient } from '../../../infrastructure/http/client.js'
import { badRequest } from '../../../infrastructure/mock/helpers/errors.js'
import { mockOrHttp } from '../../../infrastructure/mock/helpers/mock-handler.js'

/**
 * Cross-aggregate use case: advancing an order updates both the order
 * and the linked project's history (and stage on final approval).
 */
export function makeAdvanceOrderRequest({ orderRepo, projectRepo }) {
  return function advanceOrderRequest(id, { actor, notes = '' }) {
    return mockOrHttp(
      () => {
        const { idx, order } = orderRepo.advanceOrderInStore(id, { actor, notes })
        const nextStatus = ORDER_STEP_NEXT[order.status]
        if (!nextStatus) badRequest('Bu talep zaten tamamlandı.')

        const now = new Date().toISOString()
        const historyEntry = {
          id: `oh-${Date.now()}`,
          step: nextStatus,
          step_label: ORDER_STEP_LABELS[nextStatus],
          signed_by_id: actor.id,
          signed_by_name: actor.name,
          signed_by_role: actor.role,
          signed_at: now,
          notes,
        }

        const updated = {
          ...order,
          status: nextStatus,
          updated_at: now,
          order_history: [...(order.order_history ?? []), historyEntry],
        }
        orderRepo.persistOrder(idx, updated)

        const p = projectRepo.findProjectById(order.project_id)
        if (p) {
          if (nextStatus === 'onaylandi') {
            const stageFlipped = p.stage === 'uretime_hazir'
            projectRepo.recordOrderHistory(order.project_id, {
              orderId: order.id,
              actorName: actor.name,
              fromStage: p.stage,
              toStage: stageFlipped ? 'uretimde' : p.stage,
              note: `Sipariş onaylandı — ${order.requested_by_name} tarafından ${order.quantity.toLocaleString('tr-TR')} adet talep edildi`,
            })
          } else {
            projectRepo.recordOrderHistory(order.project_id, {
              orderId: order.id,
              actorName: actor.name,
              fromStage: p.stage,
              toStage: p.stage,
              note: `${ORDER_STEP_LABELS[nextStatus]} — ${actor.name}`,
            })
          }
        }

        return { ...updated }
      },
      async () => {
        const { data } = await httpClient.patch(`/order-requests/${id}/advance`, { notes })
        return data
      },
    )
  }
}
