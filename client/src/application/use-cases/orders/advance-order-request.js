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
export function makeAdvanceOrderRequest({ orderRepo, projectRepo, userRepo }) {
  return function advanceOrderRequest(id, { actor, notes = '', assignees = null, expectedVersion = null } = {}) {
    return mockOrHttp(
      () => {
        const { idx, order } = orderRepo.advanceOrderInStore(id, { actor, notes, expectedVersion })
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
        // Guard against an empty assignee list reaching the data layer (the UI
        // also blocks it, but the API must enforce it on its own).
        const isAssignStep = order.status === 'pending'
        if (isAssignStep) {
          if (!Array.isArray(assignees) || assignees.length === 0) {
            badRequest('Tasarımcı seçmeden talebi aktaramazsın.')
          }
          // Every id must resolve to an active designer — otherwise we either
          // silently lose the assignee (if deactivated) or assign a non-designer
          // (printer/satis/team_leader), both of which leave the order stuck.
          for (const id of assignees) {
            const u = userRepo.findById(id)
            if (!u) badRequest(`Tasarımcı bulunamadı: ${id}`)
            if (u.role !== 'designer') badRequest(`${u.name} tasarımcı değil.`)
            if (u.is_active === false) badRequest(`${u.name} pasif durumda, atanamaz.`)
          }
          const before = projectRepo.findProjectById(order.project_id)
          const prevNames = (before?.assignees ?? []).map((a) => a.name).join(', ')
          const after = projectRepo.assignDesigners(order.project_id, assignees)
          // Push the freshly-assigned project into the shared store immediately
          // so the bell red-dots reflect the new team without waiting for the
          // 30 s project-list refresh. Without this the old designer keeps
          // seeing the project in their queue until the next tick.
          if (after && typeof projectRepo.onProjectChanged === 'function') {
            projectRepo.onProjectChanged(after)
          }
          // Append a visible history row whenever the assignee set actually
          // changed, so a future reader can tell who used to own this pass.
          if (before) {
            const newNames = assignees
              .map((id) => userRepo.findById(id)?.name)
              .filter(Boolean)
              .join(', ')
            if (prevNames !== newNames) {
              projectRepo.recordOrderHistory(order.project_id, {
                actorName: actor.name,
                fromStage: before.stage,
                toStage: before.stage,
                note: `Tasarımcı kadrosu güncellendi: ${prevNames || '—'} → ${newNames}`,
              })
            }
          }
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
