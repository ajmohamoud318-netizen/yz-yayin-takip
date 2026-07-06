import { ORDER_REJECT_TO, ORDER_REJECT_TARGETS, ORDER_STEP_LABELS, ORDER_STEP_OWNER } from '../../../domain/index.js'
import { httpClient } from '../../../infrastructure/http/client.js'
import { badRequest } from '../../../infrastructure/mock/helpers/errors.js'
import { uid } from '../../../infrastructure/mock/helpers/id.js'
import { mockOrHttp } from '../../../infrastructure/mock/helpers/mock-handler.js'

/**
 * Reject a sales-side ozalit. Mirrors advance, but routes the order BACKWARD:
 * the team leader rejects the matbaa teslim at `matbaa_onay`, sending it back to
 * `tasarimci_onay` so Matbaa re-delivers. The order's ozalit attempt counter
 * increments, the rejection (with reason) is recorded on both the order history
 * and the project history, and the project's stage is left untouched.
 */
export function makeRejectOrderRequest({ orderRepo, projectRepo }) {
  return function rejectOrderRequest(id, { actor, reason = '', routeTo = 'matbaa' }) {
    return mockOrHttp(
      () => {
        const { idx, order } = orderRepo.advanceOrderInStore(id, { actor })
        // The leader chooses who re-does the rejected ozalit: the Tasarımcı
        // (→ görüldü) or the Matbaa (→ tasarımcı onayı / re-delivery). Falls back
        // to the fixed matbaa loop if no valid choice was supplied.
        const target =
          ORDER_REJECT_TARGETS[order.status]?.[routeTo] ?? ORDER_REJECT_TO[order.status]
        if (!target) badRequest('Bu adım reddedilemez.')
        // Only the role that owns the rejected step may reject it (matbaa_onay is
        // owned by the team leader). Enforced in the data layer, not just the UI.
        const owner = ORDER_STEP_OWNER[order.status]
        if (owner && actor?.role !== owner) {
          badRequest('Bu adımı yalnızca ilgili rol reddedebilir.')
        }
        if (!reason.trim()) badRequest('Red sebebi zorunludur.')

        const now = new Date().toISOString()
        const historyEntry = {
          id: uid('oh-'),
          step: target,
          step_label: ORDER_STEP_LABELS[target],
          action: 'reject',
          signed_by_id: actor.id,
          signed_by_name: actor.name,
          signed_by_role: actor.role,
          signed_at: now,
          notes: reason,
          reason,
        }

        const updated = {
          ...order,
          status: target,
          ozalit_attempt: (order.ozalit_attempt ?? 0) + 1,
          updated_at: now,
          order_history: [...(order.order_history ?? []), historyEntry],
        }
        orderRepo.persistOrder(idx, updated)

        const routedText =
          target === 'goruldu' ? 'tasarımcıya geri gönderildi' : 'matbaaya geri gönderildi'
        const p = projectRepo.findProjectById(order.project_id)
        if (p) {
          projectRepo.recordOrderHistory(order.project_id, {
            orderId: order.id,
            actorName: actor.name,
            fromStage: p.stage,
            toStage: p.stage, // stage unchanged — only the order loops
            note: `Sipariş ozaliti reddedildi — ${routedText} · ${reason}`,
          })
        }

        return { ...updated }
      },
      async () => {
        const { data } = await httpClient.post(`/order-requests/${id}/reject`, { reason })
        return data
      },
    )
  }
}
