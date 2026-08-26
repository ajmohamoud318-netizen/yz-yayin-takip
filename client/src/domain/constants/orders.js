/** Sipariş talep mini-workflow — separate from the main project pipeline. */

export const ORDER_STEPS = [
  'pending', 'goruldu', 'kontrol_edildi', 'tasarimci_onay', 'ekran_onay',
  'matbaa_onay', 'siparis_baski_onay', 'onaylandi',
]

export const ORDER_STEP_LABELS = {
  pending: 'Talep',
  goruldu: 'Tasarımcıya Aktarıldı',
  kontrol_edildi: 'Kontrol Edildi',
  tasarimci_onay: 'Ozalit İstendi',
  ekran_onay: 'Ekran Onayı',
  matbaa_onay: 'Onay Bekleniyor',
  siparis_baski_onay: 'Baskı Onayı',
  onaylandi: 'Baskıda',
  // Sub-events logged inside order_history while status stays at matbaa_onay
  // (never an order.status value themselves) — without these, ProjectDetail's
  // order_step_label lookup falls back to the raw step key.
  matbaa_received: 'Matbaa Teslimi Alındı',
  matbaa_not_received: 'Matbaa Teslimi Alınamadı',
  matbaa_approve: 'Matbaa Onayı Verildi',
  // The sipariş's own ozalit sheet, written when the designer submits the
  // Ozalit Üretim Formu at kontrol_edildi (migration 053's demos.order_id).
  ozalit_form: 'Ozalit Formu Gönderildi',
  // Sub-events for the order's own ozalit-started/cancel/edit/change-request
  // flow (migration 051, full parity with the main pipeline's demo/ozalit
  // started flow — migrations 048/049), logged while status stays at
  // tasarimci_onay.
  ozalit_started: 'Matbaa Ozalite Başladı',
  ozalit_cancelled: 'Ozalit Talebi İptal Edildi',
  ozalit_edited: 'Ürün Bilgileri Güncellendi',
  ozalit_change_requested: 'Değişiklik İstendi',
  ozalit_change_accepted: 'Değişiklik Kabul Edildi',
  ozalit_change_declined: 'Değişiklik Reddedildi',
}

// Which order_history steps belong to the ozalit/proof round — i.e. should
// render/print the Ozalit form (OzalitStepSheet), not the generic Baskı
// Formu or the later Baskı Onayı form. matbaa_received/matbaa_not_received/
// matbaa_approve are sub-events logged while the order sits at matbaa_onay,
// so they belong to the same round as matbaa_onay itself.
export const ORDER_OZALIT_ROUND_STEPS = new Set([
  'tasarimci_onay', 'ekran_onay', 'matbaa_onay',
  'matbaa_received', 'matbaa_not_received', 'matbaa_approve',
  'ozalit_form', 'ozalit_started', 'ozalit_cancelled', 'ozalit_edited',
  'ozalit_change_requested', 'ozalit_change_accepted', 'ozalit_change_declined',
])

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
//
// goruldu and kontrol_edildi are the SAME designer's two steps (migration
// 054): "Kontrolleri Yapın" (alt görevler + ürün bilgileri), then "Ozalit
// İsteyin", which opens the Ozalit Üretim Formu — that form's own submit is
// what advances the order, not a bare click.
export const ORDER_STEP_OWNER = {
  pending: 'team_leader',
  goruldu: 'designer',
  kontrol_edildi: 'designer',
  tasarimci_onay: 'printer',
  ekran_onay: 'team_leader',
  matbaa_onay: 'team_leader',
  siparis_baski_onay: 'team_leader',
}

// kontrol_edildi's entry below is the DEFAULT/first-submission destination
// only. On a resubmit (order.last_reject_type === 'designer') the server
// overrides `next` with the designer's chosen `route` ('tasarimci_onay' |
// 'ekran_onay') instead of consulting this map — see orderStepPath below and
// the Ozalit Üretim Formu's own resubmit choice (SpecFormDialog's
// orderContext), which is where that pick moved with migration 054.
//
// matbaa_onay now points at siparis_baski_onay, not onaylandi directly — the
// print-spec gate sits between the proof round and production.
export const ORDER_STEP_NEXT = {
  pending: 'goruldu',
  goruldu: 'kontrol_edildi',
  kontrol_edildi: 'tasarimci_onay',
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

// The pipeline is no longer strictly linear — from `kontrol_edildi` a
// resubmit can go to either `tasarimci_onay` or `ekran_onay`. These two
// constants are the two possible full linear paths an order can take, for
// anything that needs to render a step sequence (pipeline visualizers,
// "future steps" lists).
export const ORDER_STEP_PATH_DEFAULT = [
  'pending', 'goruldu', 'kontrol_edildi', 'tasarimci_onay', 'matbaa_onay',
  'siparis_baski_onay', 'onaylandi',
]
export const ORDER_STEP_PATH_EKRAN_ONAY = [
  'pending', 'goruldu', 'kontrol_edildi', 'ekran_onay', 'siparis_baski_onay', 'onaylandi',
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
    // The designer's two steps (migration 054): the checks, then the ozalit
    // request. Same owner, same assignment rule — only the dialog each one
    // opens differs (TalepSignDialog vs the Ozalit Üretim Formu).
    case 'goruldu':
    case 'kontrol_edildi':
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

/**
 * Which mode the sipariş's Ozalit Üretim Formu opens in for `user`.
 *
 * The sheet is the same component the main pipeline uses (SpecFormDialog's
 * ozalit variant), so it has the same three jobs — and which one it is
 * depends on the step exactly the way it does for a project:
 *
 *   • tasarimci_onay + matbaa  → 'advance'. The printer's "Ozaliti Teslim
 *     Edin" stamps TESLİM TARİHİ / TESLİM EDEN KİŞİ / MATBAA YETKİLİSİ onto
 *     this round's sheet, the twin of ozalit_teslim on the main pipeline.
 *     Before this existed the sipariş's proof was delivered by a bare
 *     advance click and none of those stamps were ever recorded.
 *   • matbaa_onay + leader/assigned designer → 'approve'. The sipariş's
 *     ozalit_onay: the receipt gate and the leader-first rule live inside
 *     the form (see canApproveMatbaaOnayNow for the same checks), and the
 *     approving signature is stamped as ONAYLAYAN KİŞİ.
 *   • kontrol_edildi + assigned designer → 'advance'. The designer's own
 *     "Ozalit İsteyin" step (migration 054): they author the sheet and
 *     sending it IS the request. On a resubmit the sheet also carries the
 *     tasarimci_onay / ekran_onay route choice — it used to sit in the sign
 *     dialog, but that dialog no longer owns this half of the turn.
 *   • everything else → 'view'. A read-only look at the round's sheet.
 */
export function orderOzalitFormMode(order, user) {
  if (!order || !user) return 'view'
  if (order.status === 'kontrol_edildi') {
    const isAssignedDesigner =
      user.role === 'designer' && (order.assignee_ids ?? []).includes(user.id)
    if (isAssignedDesigner) return 'advance'
  }
  if (order.status === 'tasarimci_onay' && user.role === 'printer') return 'advance'
  if (order.status === 'matbaa_onay') {
    const isAssignedDesigner =
      user.role === 'designer' && (order.assignee_ids ?? []).includes(user.id)
    if (user.role === 'team_leader' || isAssignedDesigner) return 'approve'
  }
  return 'view'
}
