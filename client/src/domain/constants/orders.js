/** Sipariş talep mini-workflow — separate from the main project pipeline. */

export const ORDER_STEPS = ['pending', 'goruldu', 'tasarimci_onay', 'matbaa_onay', 'onaylandi']

export const ORDER_STEP_LABELS = {
  pending: 'Talep Gönderildi',
  goruldu: 'Tasarımcıya Aktarıldı',
  tasarimci_onay: 'Tasarımcı Onayı',
  matbaa_onay: 'Matbaa Teslimi',
  onaylandi: 'Üretime Alındı',
}

// `matbaa_onay` is multi-party, leader-first (every active team leader AND
// every order assignee must approve — see computeMatbaaOnayApproval on the
// server, `canApproveMatbaaOnayNow` below), NOT a flat single-owner step.
// The 'team_leader' value below is only documentary here — the /advance
// route special-cases matbaa_onay before ever consulting this map.
export const ORDER_STEP_OWNER = {
  pending: 'team_leader',
  goruldu: 'designer',
  tasarimci_onay: 'printer',
  matbaa_onay: 'team_leader',
}

export const ORDER_STEP_NEXT = {
  pending: 'goruldu',
  goruldu: 'tasarimci_onay',
  tasarimci_onay: 'matbaa_onay',
  matbaa_onay: 'onaylandi',
}

/**
 * Where a rejection sends the order. The team leader reviews the matbaa teslim
 * (the reprint's sales-side ozalit) at `matbaa_onay` and, on rejection, decides
 * which part of the loop re-does the work:
 *   • 'matbaa'    → back to `tasarimci_onay` so Matbaa re-delivers a fresh ozalit
 *                   (design untouched) — the original behaviour.
 *   • 'designer'  → back to `goruldu` so the Tasarımcı reworks it first.
 *   • 'reassign'  → all the way back to `pending` so the leader can pick a
 *                   different team. Use this when the originally-assigned
 *                   designers are unavailable / wrong. Reassignment goes
 *                   through the same assign-step UI as a fresh order.
 * The ozalit attempt counter increments each time, mirroring a first-edition
 * ozalit rejection (which offers the same Tasarımcı / Matbaa choice).
 */
export const ORDER_REJECT_TARGETS = {
  matbaa_onay: {
    matbaa: 'tasarimci_onay',
    designer: 'goruldu',
    reassign: 'pending',
  },
}

// Default destination (matbaa re-delivery). Kept so `canReject` checks and any
// caller that doesn't pass a target keep working.
export const ORDER_REJECT_TO = {
  matbaa_onay: 'tasarimci_onay',
}

/**
 * Is this order sitting on `designerId`'s desk?
 *
 * The authoritative record of who the team leader picked at the assign step is
 * the order's OWN `assignee_ids` — the server persists the full selection there
 * (`UPDATE order_requests SET assignee_ids = ...`). Read that first.
 *
 * Both designer-facing views used to derive ownership from the linked project's
 * `assignees` instead, which silently hid orders for two compounding reasons:
 *
 *   1. The assign step writes only `assigned_to: assignees[0]` on the project,
 *      so the 2nd..8th designer of a multi-select never appeared there at all.
 *   2. `project.assignees` is built server-side from SUBTASK owners, and admits
 *      the project primary only if they also own a subtask. A sipariş transfer
 *      creates no subtask, so even the first designer was usually absent.
 *
 * Net effect: the designer got the "Sipariş kontrolünüzü bekliyor" notification,
 * clicked through to /siparis-onay, and found an empty list.
 *
 * `fallbackProjectIds` keeps legacy orders visible — rows written before
 * `assignee_ids` was populated have no selection to read, so for those (and
 * only those) we still fall back to project assignment.
 */
export function isOrderAssignedToDesigner(order, designerId, fallbackProjectIds) {
  if (!order || !designerId) return false
  const ids = Array.isArray(order.assignee_ids) ? order.assignee_ids : []
  if (ids.length > 0) return ids.includes(designerId)
  return fallbackProjectIds?.has?.(order.project_id) ?? false
}

/**
 * Client-side mirror of the server's matbaa_onay leader-first gate
 * (computeMatbaaOnayApproval), used to hide/disable the approve button
 * before hitting the server. Direct port of `ozalitLeaderApproved` /
 * `canApproveOzalitNow` in `domain/services/pipeline.js`, adapted to
 * `order.assignee_ids` — a flat id array, unlike a project's `assignees`
 * (`{id, name}` objects) — since the order already carries its own snapshot
 * of who was picked, no `loadProjectAssignees`-style merge needed.
 */
export function matbaaOnayLeaderApproved(order) {
  return (order?.matbaa_approvals ?? []).some((a) => a.role === 'team_leader')
}

export function canApproveMatbaaOnayNow(user, order) {
  if (!user || !order) return false
  if (!order.matbaa_received) return false
  if (user.role === 'team_leader') return true
  const isAssignedDesigner =
    user.role === 'designer' && (order.assignee_ids ?? []).includes(user.id)
  return isAssignedDesigner && matbaaOnayLeaderApproved(order)
}
