import {
  ORDER_STEP_LABELS,
  ORDER_STEP_NEXT,
  ORDER_STEP_OWNER,
  assertCanEnterProduction,
} from '../../../domain/index.js'
import { httpClient } from '../../../infrastructure/http/client.js'
import { badRequest } from '../../../infrastructure/mock/helpers/errors.js'
import { uid } from '../../../infrastructure/mock/helpers/id.js'
import { mockOrHttp } from '../../../infrastructure/mock/helpers/mock-handler.js'

/**
 * Cross-aggregate use case: advancing an order updates both the order
 * and the linked project's history (and stage on final approval).
 */
export function makeAdvanceOrderRequest({ orderRepo, projectRepo }) {
  return function advanceOrderRequest(id, { actor, notes = '', assignees = null }) {
    return mockOrHttp(
      () => {
        const { idx, order } = orderRepo.advanceOrderInStore(id, { actor, notes })
        const nextStatus = ORDER_STEP_NEXT[order.status]
        if (!nextStatus) badRequest('Bu talep zaten tamamlandı.')

        // Only the role that OWNS the current step may sign it through. The UI
        // already routes each step to the right role, but the data layer is the
        // real gate (mirrors the future backend's per-route role middleware).
        const owner = ORDER_STEP_OWNER[order.status]
        if (owner && actor?.role !== owner) {
          badRequest('Bu adımı yalnızca ilgili rol imzalayabilir.')
        }

        // Final approval (onaylandi) takes the book into üretim. Enforce the same
        // 100%-progress gate the normal advance path uses: if the designer flagged
        // subtasks as "revize" during this pass, progress drops below 100 and the
        // order must NOT be signable into production. Checked here — before the
        // order is persisted — so a blocked approval leaves no partial state.
        if (nextStatus === 'onaylandi') {
          const proj = projectRepo.findProjectById(order.project_id)
          if (proj && proj.stage === 'uretime_hazir') {
            assertCanEnterProduction('uretimde', proj.progress)
          }
        }

        // Assign step (pending → goruldu): the team leader picks the designer(s)
        // who will check this run — the original ones or different ones. We set
        // them on the project (the current pass) and record them on the order.
        const isAssignStep = order.status === 'pending'
        if (isAssignStep && Array.isArray(assignees) && assignees.length > 0) {
          projectRepo.assignDesigners(order.project_id, assignees)
        }

        const now = new Date().toISOString()
        const historyEntry = {
          id: uid('oh-'),
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
          ...(isAssignStep && Array.isArray(assignees) && assignees.length > 0
            ? { assignee_ids: assignees }
            : {}),
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
