/** Sipariş talep mini-workflow — separate from the main project pipeline. */

export const ORDER_STEPS = [
  'pending', 'goruldu', 'tasarimci_onay', 'ekran_onay', 'matbaa_onay',
  'siparis_baski_onay', 'onaylandi',
]

export const ORDER_STEP_LABELS = {
  pending: 'Talep',
  goruldu: 'Tasarımcıya Aktarıldı',
  tasarimci_onay: 'Ozalit İstendi',
  ekran_onay: 'Ekran Onayı',
  matbaa_onay: 'Onay Bekleniyor',
  siparis_baski_onay: 'Baskı Onayı',
  onaylandi: 'Baskıda',
}

// matbaa_onay is multi-party, leader-first (every active team leader AND
// every order assignee must approve — see computeMatbaaOnayApproval on the
// server, `canApproveMatbaaOnayNow` below), NOT a flat single-owner step.
// The 'team_leader' value below is only documentary here — the /advance
// route special-cases matbaa_onay before ever consulting this map.
//
// ekran_onay IS a flat single-owner step (team_leader, one click, no
// receipt gate, no ledger — unlike matbaa_onay).
//
// siparis_baski_onay's 'team_leader' entry is documentary only: it's never
// reached via the generic /advance route — it requires the dedicated
// form-fill-then-approve routes instead (see SiparisBaskiOnayFormDialog).
export const ORDER_STEP_OWNER = {
  pending: 'team_leader',
  goruldu: 'designer',
  tasarimci_onay: 'printer',
  ekran_onay: 'team_leader',
  matbaa_onay: 'team_leader',
  siparis_baski_onay: 'team_leader',
}

// goruldu's entry below is the DEFAULT/first-submission destination only.
// On a resubmit (order.last_reject_type === 'designer') the server overrides
// `next` with the designer's chosen `route` ('tasarimci_onay' | 'ekran_onay')
// instead of consulting this map — see orderStepPath below and
// TalepSignDialog's resubmit choice UI.
//
// matbaa_onay now points at siparis_baski_onay, not onaylandi directly — the
// print-spec gate sits between the proof round and production.
export const ORDER_STEP_NEXT = {
  pending: 'goruldu',
  goruldu: 'tasarimci_onay',
  tasarimci_onay: 'matbaa_onay',
  ekran_onay: 'siparis_baski_onay',
  matbaa_onay: 'siparis_baski_onay',
  siparis_baski_onay: 'onaylandi',
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
 *
 * ekran_onay only offers a 'designer' target — it never touches the
 * printer (no physical proof was ever delivered), so there's no 'matbaa'
 * route, and no 'reassign' either — a leader can still reassign from a
 * later reject once the resubmit reaches matbaa_onay again.
 */
export const ORDER_REJECT_TARGETS = {
  matbaa_onay: {
    matbaa: 'tasarimci_onay',
    designer: 'goruldu',
    reassign: 'pending',
  },
  ekran_onay: {
    designer: 'goruldu',
  },
}

// Default destination per step. Kept so `canReject` checks and any caller
// that doesn't pass a target keep working.
export const ORDER_REJECT_TO = {
  matbaa_onay: 'tasarimci_onay',
  ekran_onay: 'goruldu',
}

// The pipeline is no longer strictly linear — from `goruldu` a resubmit can
// go to either `tasarimci_onay` or `ekran_onay`. These two constants are the
// two possible full linear paths an order can take, for anything that needs
// to render a step sequence (pipeline visualizers, "future steps" lists).
export const ORDER_STEP_PATH_DEFAULT = [
  'pending', 'goruldu', 'tasarimci_onay', 'matbaa_onay', 'siparis_baski_onay', 'onaylandi',
]
export const ORDER_STEP_PATH_EKRAN_ONAY = [
  'pending', 'goruldu', 'ekran_onay', 'siparis_baski_onay', 'onaylandi',
]

/**
 * Which of the two linear paths this order actually took. Checked against
 * order_history (not just current status) so a COMPLETED order still
 * renders the branch it took, not the default one.
 */
export function orderStepPath(order) {
  const tookEkranOnay = order?.status === 'ekran_onay'
    || (order?.order_history ?? []).some((h) => h.step === 'ekran_onay')
  return tookEkranOnay ? ORDER_STEP_PATH_EKRAN_ONAY : ORDER_STEP_PATH_DEFAULT
}

// Steps where the team leader owes an action — drives nav badge counts and
// the "action" tab in SiparisTalepleri. Centralized here so AppShell and
// SiparisTalepleri don't maintain two independent hardcoded copies.
export const ORDER_LEADER_ACTION_STEPS = new Set(['pending', 'ekran_onay', 'matbaa_onay', 'siparis_baski_onay'])

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

/**
 * Does `user` owe the next action on `order` right now? Each role-scoped
 * queue page (MyProjects, SiparisOnay, SiparisTalepleri) only ever shows
 * orders already filtered to that one role, so none of them needed this —
 * they just checked the matbaa_onay receipt/leader-first nuance inline.
 * ProjectDetail shows a project's orders to whoever opens it regardless of
 * role, so it needs the full per-step ownership check centralized here
 * instead of re-deriving a partial version of it.
 */
export function canActOnOrder(user, order, fallbackProjectIds) {
  if (!user || !order) return false
  switch (order.status) {
    case 'pending':
    case 'ekran_onay':
    case 'siparis_baski_onay':
      return user.role === 'team_leader'
    case 'tasarimci_onay':
      return user.role === 'printer'
    case 'goruldu':
      return user.role === 'designer' && isOrderAssignedToDesigner(order, user.id, fallbackProjectIds)
    case 'matbaa_onay': {
      const isAssignedDesigner =
        user.role === 'designer' && (order.assignee_ids ?? []).includes(user.id)
      if (user.role !== 'team_leader' && !isAssignedDesigner) return false
      // Receipt gate ("Teslim Alındı") comes before the leader-first
      // approval and either role can clear it — canApproveMatbaaOnayNow
      // only covers the approval half (it requires matbaa_received=true).
      if (!order.matbaa_received) return true
      return canApproveMatbaaOnayNow(user, order)
    }
    default:
      return false
  }
}
