/** Sipariş talep mini-workflow — separate from the main project pipeline. */

export const ORDER_STEPS = [
  'atama_bekleniyor', 'tasarimciya_atandi', 'kontroller_tamam',
  'matbaa_ozalit_yapiyor', 'ekran_onayinda', 'imza_bekleniyor',
  'baski_onayi_bekleniyor', 'baskida',
]

export const ORDER_STEP_LABELS = {
  atama_bekleniyor: 'Atama Bekleniyor',
  tasarimciya_atandi: 'Tasarımcıya Atandı',
  kontroller_tamam: 'Kontroller Tamam',
  matbaa_ozalit_yapiyor: 'Matbaa Ozalit Yapıyor',
  ekran_onayinda: 'Ekran Onayında',
  imza_bekleniyor: 'İmza Bekleniyor',
  baski_onayi_bekleniyor: 'Baskı Onayı Bekleniyor',
  baskida: 'Baskıda',
  // Sub-events logged inside order_history while status stays at imza_bekleniyor
  // (never an order.status value themselves) — without these, ProjectDetail's
  // order_step_label lookup falls back to the raw step key.
  matbaa_received: 'Matbaa Teslimi Alındı',
  matbaa_not_received: 'Matbaa Teslimi Alınamadı',
  matbaa_approve: 'Matbaa Onayı Verildi',
  // The sipariş's own ozalit sheet, written when the designer submits the
  // Ozalit Üretim Formu at kontroller_tamam (migration 053's demos.order_id).
  ozalit_form: 'Ozalit Formu Gönderildi',
  // Sub-events for the order's own ozalit-started/cancel/edit/change-request
  // flow (migration 051, full parity with the main pipeline's demo/ozalit
  // started flow — migrations 048/049), logged while status stays at
  // matbaa_ozalit_yapiyor.
  ozalit_started: 'Matbaa Ozalite Başladı',
  ozalit_cancelled: 'Ozalit Talebi İptal Edildi',
  ozalit_edited: 'Ürün Bilgileri Güncelleri',
  ozalit_change_requested: 'Değişiklik İstendi',
  ozalit_change_accepted: 'Değişiklik Kabul Edildi',
  ozalit_change_declined: 'Değişiklik Reddedildi',
}

// Which order_history steps belong to the ozalit/proof round — i.e. should
// render/print the Ozalit form (OzalitStepSheet), not the generic Baskı
// Formu or the later Baskı Onayı form. matbaa_received/matbaa_not_received/
// matbaa_approve are sub-events logged while the order sits at imza_bekleniyor,
// so they belong to the same round as imza_bekleniyor itself.
export const ORDER_OZALIT_ROUND_STEPS = new Set([
  'matbaa_ozalit_yapiyor', 'ekran_onayinda', 'imza_bekleniyor',
  'matbaa_received', 'matbaa_not_received', 'matbaa_approve',
  'ozalit_form', 'ozalit_started', 'ozalit_cancelled', 'ozalit_edited',
  'ozalit_change_requested', 'ozalit_change_accepted', 'ozalit_change_declined',
])

// imza_bekleniyor is multi-party, leader-first (every active team leader AND
// every order assignee must approve — see computeMatbaaOnayApproval on the
// server, `canApproveMatbaaOnayNow` below), NOT a flat single-owner step.
// The 'team_leader' value below is only documentary here — the /advance
// route special-cases imza_bekleniyor before ever consulting this map.
//
// ekran_onayinda IS a flat single-owner step (team_leader, one click, no
// receipt gate, no ledger — unlike imza_bekleniyor).
//
// baski_onayi_bekleniyor's 'team_leader' entry is documentary only: it's
// never reached via the generic /advance route — it requires the dedicated
// form-fill-then-approve routes instead (see SiparisBaskiOnayFormDialog).
//
// tasarimciya_atandi and kontroller_tamam are the SAME designer's two steps
// (migration 054): "Kontrolleri Yapın" (alt görevler + ürün bilgileri),
// then "Ozalit İsteyin", which opens the Ozalit Üretim Formu — that form's
// own submit is what advances the order, not a bare click.
export const ORDER_STEP_OWNER = {
  atama_bekleniyor: 'team_leader',
  tasarimciya_atandi: 'designer',
  kontroller_tamam: 'designer',
  matbaa_ozalit_yapiyor: 'printer',
  ekran_onayinda: 'team_leader',
  imza_bekleniyor: 'team_leader',
  baski_onayi_bekleniyor: 'team_leader',
}

// kontroller_tamam's entry below is the DEFAULT/first-submission destination
// only. On a resubmit (order.last_reject_type === 'designer') the server
// overrides `next` with the designer's chosen `route` ('matbaa_ozalit_yapiyor'
// | 'ekran_onayinda') instead of consulting this map — see orderStepPath
// below and the Ozalit Üretim Formu's own resubmit choice (SpecFormDialog's
// orderContext), which is where that pick moved with migration 054.
//
// imza_bekleniyor now points at baski_onayi_bekleniyor, not baskida directly
// — the print-spec gate sits between the proof round and production.
export const ORDER_STEP_NEXT = {
  atama_bekleniyor: 'tasarimciya_atandi',
  tasarimciya_atandi: 'kontroller_tamam',
  kontroller_tamam: 'matbaa_ozalit_yapiyor',
  matbaa_ozalit_yapiyor: 'imza_bekleniyor',
  ekran_onayinda: 'baski_onayi_bekleniyor',
  imza_bekleniyor: 'baski_onayi_bekleniyor',
  baski_onayi_bekleniyor: 'baskida',
}

/**
 * Where a rejection sends the order. The team leader reviews the matbaa teslim
 * (the reprint's sales-side ozalit) at `imza_bekleniyor` and, on rejection,
 * decides which part of the loop re-does the work:
 *   • 'matbaa'    → back to `matbaa_ozalit_yapiyor` so Matbaa re-delivers a
 *                   fresh ozalit (design untouched) — the original behaviour.
 *   • 'designer'  → back to `tasarimciya_atandi` so the Tasarımcı reworks
 *                   it first.
 *   • 'reassign'  → all the way back to `atama_bekleniyor` so the leader
 *                   can pick a different team. Use this when the
 *                   originally-assigned designers are unavailable / wrong.
 *                   Reassignment goes through the same assign-step UI as a
 *                   fresh order.
 * The ozalit attempt counter increments each time, mirroring a first-edition
 * ozalit rejection (which offers the same Tasarımcı / Matbaa choice).
 *
 * ekran_onayinda only offers a 'designer' target — it never touches the
 * printer (no physical proof was ever delivered), so there's no 'matbaa'
 * route, and no 'reassign' either — a leader can still reassign from a
 * later reject once the resubmit reaches imza_bekleniyor again.
 */
export const ORDER_REJECT_TARGETS = {
  imza_bekleniyor: {
    matbaa: 'matbaa_ozalit_yapiyor',
    designer: 'tasarimciya_atandi',
    reassign: 'atama_bekleniyor',
  },
  ekran_onayinda: {
    designer: 'tasarimciya_atandi',
  },
}

// Default destination per step. Kept so `canReject` checks and any caller
// that doesn't pass a target keep working.
export const ORDER_REJECT_TO = {
  imza_bekleniyor: 'matbaa_ozalit_yapiyor',
  ekran_onayinda: 'tasarimciya_atandi',
}

// The pipeline is no longer strictly linear — from `kontroller_tamam` a
// resubmit can go to either `matbaa_ozalit_yapiyor` or `ekran_onayinda`.
// These two constants are the two possible full linear paths an order can
// take, for anything that needs to render a step sequence (pipeline
// visualizers, "future steps" lists).
export const ORDER_STEP_PATH_DEFAULT = [
  'atama_bekleniyor', 'tasarimciya_atandi', 'kontroller_tamam',
  'matbaa_ozalit_yapiyor', 'imza_bekleniyor',
  'baski_onayi_bekleniyor', 'baskida',
]
export const ORDER_STEP_PATH_EKRAN_ONAY = [
  'atama_bekleniyor', 'tasarimciya_atandi', 'kontroller_tamam',
  'ekran_onayinda', 'baski_onayi_bekleniyor', 'baskida',
]

/**
 * Which of the two linear paths this order actually took. Checked against
 * order_history (not just current status) so a COMPLETED order still
 * renders the branch it took, not the default one.
 */
export function orderStepPath(order) {
  const tookEkranOnay = order?.status === 'ekran_onayinda'
    || (order?.order_history ?? []).some((h) => h.step === 'ekran_onayinda')
  return tookEkranOnay ? ORDER_STEP_PATH_EKRAN_ONAY : ORDER_STEP_PATH_DEFAULT
}

// Steps where the team leader owes an action — drives nav badge counts and
// the "action" tab in SiparisTalepleri. Centralized here so AppShell and
// SiparisTalepleri don't maintain two independent hardcoded copies.
export const ORDER_LEADER_ACTION_STEPS = new Set([
  'atama_bekleniyor', 'ekran_onayinda', 'imza_bekleniyor', 'baski_onayi_bekleniyor',
])

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
 * Client-side mirror of the server's imza_bekleniyor leader-first gate
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
 * they just checked the imza_bekleniyor receipt/leader-first nuance inline.
 * ProjectDetail shows a project's orders to whoever opens it regardless of
 * role, so it needs the full per-step ownership check centralized here
 * instead of re-deriving a partial version of it.
 */
export function canActOnOrder(user, order, fallbackProjectIds) {
  if (!user || !order) return false
  switch (order.status) {
    case 'atama_bekleniyor':
    case 'ekran_onayinda':
    case 'baski_onayi_bekleniyor':
      return user.role === 'team_leader'
    case 'matbaa_ozalit_yapiyor':
      return user.role === 'printer'
    // The designer's two steps (migration 054): the checks, then the ozalit
    // request. Same owner, same assignment rule — only the dialog each one
    // opens differs (TalepSignDialog vs the Ozalit Üretim Formu).
    case 'tasarimciya_atandi':
    case 'kontroller_tamam':
      return user.role === 'designer' && isOrderAssignedToDesigner(order, user.id, fallbackProjectIds)
    case 'imza_bekleniyor': {
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
 *   • kontroller_tamam + assigned designer → 'advance'. The designer's own
 *     "Ozalit İsteyin" step (migration 054): they author the sheet and
 *     sending it IS the request. On a resubmit the sheet also carries the
 *     matbaa_ozalit_yapiyor / ekran_onayinda route choice — it used to sit
 *     in the sign dialog, but that dialog no longer owns this half of the turn.
 *   • matbaa_ozalit_yapiyor + matbaa → 'advance'. The printer's "Ozaliti
 *     Teslim Edin" stamps TESLİM TARİHİ / TESLİM EDEN KİŞİ / MATBAA
 *     YETKİLİSİ onto this round's sheet, the twin of ozalit_teslim on the
 *     main pipeline. Before this existed the sipariş's proof was delivered
 *     by a bare advance click and none of those stamps were ever recorded.
 *   • imza_bekleniyor + leader/assigned designer → 'approve'. The sipariş's
 *     ozalit_onay: the receipt gate and the leader-first rule live inside
 *     the form (see canApproveMatbaaOnayNow for the same checks), and the
 *     approving signature is stamped as ONAYLAYAN KİŞİ.
 *   • everything else → 'view'. A read-only look at the round's sheet.
 */
export function orderOzalitFormMode(order, user) {
  if (!order || !user) return 'view'
  if (order.status === 'kontroller_tamam') {
    const isAssignedDesigner =
      user.role === 'designer' && (order.assignee_ids ?? []).includes(user.id)
    if (isAssignedDesigner) return 'advance'
  }
  if (order.status === 'matbaa_ozalit_yapiyor' && user.role === 'printer') return 'advance'
  if (order.status === 'imza_bekleniyor') {
    const isAssignedDesigner =
      user.role === 'designer' && (order.assignee_ids ?? []).includes(user.id)
    if (user.role === 'team_leader' || isAssignedDesigner) return 'approve'
  }
  return 'view'
}