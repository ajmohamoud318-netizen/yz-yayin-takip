/**
 * Pure domain helpers for the project detail page.
 *
 * Zero React / API dependencies — every function here is a pure computation
 * over its inputs.  Extracted from ProjectDetail.jsx so the page component
 * (and any future consumer) can import them without pulling in React.
 */
import {
  ORDER_STEP_LABELS,
  orderStepPath,
} from '../constants/orders.js'
import {
  isLegacyProject,
  canApproveOzalitNow,
} from './pipeline.js'

// ---------------------------------------------------------------------------
// Order helpers
// ---------------------------------------------------------------------------

// "Open" mirrors useOpenOrdersByProject/findOpenByProject — not yet at a
// terminal step. A project can have more than one of these in flight at
// once (concurrent sipariş orders on the same product are allowed), so this
// page shows one stepper per active order rather than assuming there's only
// ever one.
export const isActiveOrder = (o) => o.status !== 'onaylandi' && o.status !== 'rejected'

// The order's own status only ever reaches 'onaylandi' (Üretimde) — what
// happens after that (Matbaa requesting handover, Satış confirming it) is
// real project/handover state, not a status this order will ever carry.
// Appending it here as two derived steps is what lets the tracker keep
// filling in for real after approval instead of freezing dead on Üretimde
// forever.
export const DISPLAY_ORDER_STEP_LABELS = {
  ...ORDER_STEP_LABELS,
  // Short form: the stepper gives each step ~40px at 390px, and "Kontrol
  // Edildi" is only ever read next to the steps around it.
  kontrol_edildi: 'Kontrol',
  teslim_bekleniyor: 'Teslim Bekleniyor',
  satista: 'Satışta',
}

// Mirrors the per-page action labels in MyProjects/SiparisOnay/SiparisTalepleri
// (each only ever renders one of these for its own role's queue) — collected
// here since this page shows a project's orders to whichever role opens it.
// matbaa_onay reads as "Onaylayın" here too so the leader sees the same
// verb they saw in the queue card; the receipt gate ("Teslim Alındı" /
// "Teslim Alınamadı") is presented inside the dialog when matbaa_received
// is still false, before the approval click — see TalepSignDialog's
// matbaa_onay handling. This keeps the detail page in lock-step with
// SiparisTalepleri so a leader who lands here from the queue doesn't see
// the action verb flip under their feet.
const ORDER_ACTION_LABELS = {
  pending: 'Tasarımcıya Aktarın',
  goruldu: 'Kontrolleri Yapın',
  kontrol_edildi: 'Ozalit İsteyin',
  tasarimci_onay: 'Teslim Edin',
  ekran_onay: 'Onaylayın',
  matbaa_onay: 'Onaylayın',
  siparis_baski_onay: 'Baskı Onay Formu',
}
export function orderActionLabel(order) {
  return ORDER_ACTION_LABELS[order.status] ?? 'Onaylayın'
}

// ---------------------------------------------------------------------------
// Action availability
// ---------------------------------------------------------------------------

/**
 * Decide which action buttons are available for the current user/stage.
 *
 * Flow: the assigned designer submits the finished design to Demo Teslim (only
 * at 100%). The printer (matbaa) forwards each *_teslim stage to the leader's
 * approval. The leader approves or rejects (reason required) at every *_onay
 * stage, and moves production / customs forward.
 */
export function availableActions({ project, user }) {
  if (!project || !user) return []
  // Imported backlist products (origin='legacy', migration 031) have no design
  // phase: no subtasks, no designer, no demo/ozalit history. Every pipeline
  // route 400s on them server-side (assertNotLegacy), so offer no transition
  // buttons at all rather than buttons that fail. A new print run for one of
  // these starts as a sipariş, which is unaffected.
  if (isLegacyProject(project)) return []
  const role = user.role
  const stage = project.stage
  const set = new Set()

  // Team leader moves a project forward. TR demo/ozalit teslim are forwarded by
  // the printer (matbaa) via the approval queue, so the leader doesn't advance
  // those — instead they see an "İstendi"/"Gönderildi" status (see demoOzalitStatusLabel).
  //
  // The leader no longer pushes a project into Satışta: reaching Satışta now
  // happens only when Sales confirms Matbaa's handover ("Alındı"). So the leader
  // advances 'tasarim' and 'cin_demo_teslim', plus ÇİN 'baskida' → 'gumruk'
  // (customs). TR 'baskida' and ÇİN 'gumruk' are handled by the handover flow.
  const leaderAdvanceable = new Set(['tasarim', 'cin_demo_teslim'])
  if (
    role === 'team_leader' &&
    (leaderAdvanceable.has(stage) || (stage === 'baskida' && project.type === 'CIN'))
  ) {
    set.add('advance')
  }
  const isAssignedDesigner =
    role === 'designer' && (project.assignees ?? []).some((a) => a.id === user.id)

  if ((stage === 'demo_onay' || stage === 'cin_demo_onay') && role === 'team_leader') {
    // Hide Onayla + Reddet until the demo has been received (Teslim Alındı)
    // and while the demo is held. The leader can't approve/reject a demo
    // they haven't taken delivery of yet, and once held, the project is
    // waiting for the designer to re-send a second demo.
    if (project.demo_received === true && project.demo_held !== true) {
      set.add('approve')
      set.add('reject')
    }
  }

  // Re-send demo: only valid on a HELD demo (approved at <100% — the
  // designer has since finished and sends the next round). A demo that's
  // freshly delivered and awaiting the leader's decision (demo_held falsey)
  // is still in progress: the leader must approve or reject it, not spawn a
  // duplicate. And while a demo is in flight at demo_teslim / cin_demo_teslim
  // the header shows the "İstendi"/"Gönderildi" pill (see demoOzalitStatusLabel).
  if (
    (stage === 'demo_onay' || stage === 'cin_demo_onay') &&
    project.demo_held === true &&
    (role === 'team_leader' || isAssignedDesigner)
  ) {
    set.add('advance')
  }

  // Ozalit Onay: multi-party approval. Every team leader AND every assigned
  // designer must approve before it advances to Üretime Hazır. Each may approve
  // once (hidden after they have). Only the team leader can reject.
  //
  // Nothing is decidable until the physical proof has been marked "Teslim
  // Alındı" (migration 035) — the same rule the demo leg has: you can't sign
  // off on a proof nobody has taken delivery of. Until then the action row
  // shows the Teslim Alındı / Teslim Alınamadı pair instead.
  if (stage === 'ozalit_onay' && project.ozalit_received === true) {
    const alreadyApproved = (project.ozalit_approvals ?? []).some((a) => a.id === user.id)
    // Each leader/designer approves once. A leader who hasn't decided yet sees
    // both Onayla and Reddet; once they approve, BOTH disappear (they've
    // committed) — a different leader who hasn't approved still sees Reddet.
    // canApproveOzalitNow also carries the leader-first rule: an assigned
    // designer gets no Onayla until a team leader has signed off (the server
    // refuses it too), so the button is never offered as a dead end.
    if (canApproveOzalitNow(user, project) && !alreadyApproved) {
      set.add('approve')
    }
    if (role === 'team_leader' && !alreadyApproved) {
      set.add('reject')
    }
  }
  // Baskı Onayı: the final sign-off, team_leader only — same people (Serpil
  // Hanım / Ayşenur, …) who may edit the form itself. Dual-approval
  // (migration 045): the button opens the same dialog whether the form still
  // needs preparing or is awaiting a different leader's approval — see
  // BaskiOnayFormDialog / SpecFormDialog's isBaskiOnayApproval branch for
  // which action it actually performs.
  if ((stage === 'baski_onay' || stage === 'cin_baski_onay') && role === 'team_leader') {
    set.add('approve')
  }
  if (isAssignedDesigner && stage === 'tasarim') {
    set.add('advance')
  }
  // Ozalit Teslim two-step handoff: the leader or assigned designer requests the
  // ozalit (which hands it to the matbaa), then the matbaa delivers it to Ozalit
  // Onay. A reject-to-matbaa locks the step to the matbaa (re-delivery). TR only.
  if (stage === 'ozalit_teslim' && project.type === 'TR') {
    const ozalitRequested = !!project.ozalit_requested
    const matbaaLock = project.reject_target === 'matbaa'
    if (role === 'printer') {
      // Teslim Et stays hidden until the matbaa has pressed İşlemi Başlat —
      // they must mark the work started before they can hand it off. Also
      // hidden while a change request is pending — the server refuses to
      // deliver until the matbaa accepts/declines it (computeOzalitTeslimAdvance),
      // so offering the button here just produces a 400.
      if ((ozalitRequested || matbaaLock) && project.ozalit_started && !project.ozalit_change_requested_at) {
        set.add('advance')
      }
    } else if (!ozalitRequested && !matbaaLock && (role === 'team_leader' || isAssignedDesigner)) {
      set.add('advance')
    }
  }

  // Printer: confirms receipt of the TR demo and forwards it to the leader's
  // onay queue. There's no separate "take into production" action anymore —
  // once baski_onay/cin_baski_onay is approved the project lands directly on
  // baskida, which the printer acts on via the handover flow instead
  // (Teslim Talepleri), not an in-detail-page advance button. Teslim Et stays
  // hidden until İşlemi Başlat has been pressed (same rule as ozalit above),
  // and while a change request is pending — the server refuses delivery
  // until the matbaa accepts/declines it (computeDemoTeslimAdvance).
  if (
    role === 'printer' && project.type === 'TR' && stage === 'demo_teslim' &&
    project.demo_started && !project.demo_change_requested_at
  ) {
    set.add('advance')
  }

  return [...set]
}

// ---------------------------------------------------------------------------
// Action labels
// ---------------------------------------------------------------------------

/** Contextual label for the "advance" action button. */
export function advanceActionLabel(project, userRole) {
  if (userRole === 'printer') {
    if (project.stage === 'demo_teslim') return "Demo'yu Teslim Edin"
    if (project.stage === 'ozalit_teslim') return 'Ozaliti Teslim Edin'
  }
  switch (project.stage) {
    case 'tasarim':
      // A design that's back in Tasarım after an ozalit rejection resubmits to
      // the ozalit flow, not the demo.
      return project.last_reject_type === 'ozalit' ? "Ozalit'e Gönderin" : "Demo'ya Gönderin"
    case 'demo_onay':
    case 'cin_demo_onay':
      // Matbaa delivered; leader can approve/reject. The leader or
      // designer can also re-trigger a new demo round.
      return 'Demo İsteyin'
    case 'ozalit_teslim':
      // Leader / assigned designer requesting the ozalit proof.
      return 'Ozalit İsteyin'
    case 'demo_teslim':
    case 'cin_demo_teslim':
      // At demo_teslim the matbaa delivers (printer). The team leader
      // or assigned designer re-triggers a new demo round.
      return userRole === 'printer' ? "Demo'yu Teslim Edin" : 'Demo İsteyin'
    case 'baskida':
      // Only ÇİN reaches here as a leader-advanceable stage (→ Gümrük). TR
      // Baskıda is closed out via the Sales handover, not this button.
      return 'Gümrüğe Gönderin'
    default:
      return 'İlerletin'
  }
}

/** Destination-aware label for the "approve" action button. */
export function approveActionLabel(project) {
  switch (project.stage) {
    case 'ozalit_onay':
      // Two-step sign-off: both the leader's and the designer's approval simply
      // read "Onaylayın" (the designer's is the final one that sends to production).
      return 'Onaylayın'
    case 'cin_demo_onay':
      // Approving the demo now sends it to ÇİN's own print-approval gate
      // (cin_baski_onay), not straight to production.
      return 'Onaylayın'
    case 'baski_onay':
    case 'cin_baski_onay':
      // Dual-approval (migration 045, and ÇİN's mirror gate from migration
      // 047): the outer button just opens the dialog, but its label should
      // say which half is still owed.
      return project.baski_onay_prepared ? 'Onaylayın' : 'Baskı Onayı Hazırlayın'
    default:
      // Demo Onay and every other approval: the leader is approving the item
      // in front of them, so the button simply reads "Onaylayın".
      return 'Onaylayın'
  }
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

/**
 * Most recent stage_history event for this project, e.g. 'demo_form_edited'.
 * History is server-ordered oldest→newest, so the last element is current.
 */
function lastHistoryEvent(project) {
  const h = project?.history ?? []
  return h.length ? h[h.length - 1].event : null
}

/**
 * "İstendi"/"Gönderildi"/"Düzeltme Bekleniyor" status shown once a demo/ozalit
 * has been requested. Checked in order:
 *   - demo_fix_pending/ozalit_fix_pending — the matbaa accepted a change
 *     request (computeDemoChangeAccept un-starts the round), so it's back to
 *     demo_started=false but for a different reason than a fresh request:
 *     the team leader owes a corrected demo/ozalit before the matbaa can
 *     resume, not the matbaa picking up an untouched request.
 *   - demo_started/ozalit_started true — the matbaa has actually pressed
 *     "İşlemi Başlatın" and is producing it ("İşleme Başlandı") — not
 *     "Gönderildi", which read as already delivered.
 *   - the leader just submitted that owed fix (computeDemoEdit/
 *     computeOzalitEdit, logged as demo_form_edited/ozalit_form_edited) —
 *     back to demo_started=false like a fresh request, but this is the
 *     *updated* form going back to the matbaa, not the original ask.
 *   - otherwise — a fresh, still-cancelable request the matbaa hasn't
 *     picked up yet ("İstendi").
 */
export function demoOzalitStatusLabel(project) {
  switch (project.stage) {
    case 'demo_teslim':
    case 'cin_demo_teslim':
      if (project.demo_fix_pending) return 'Düzeltme Bekleniyor'
      if (project.demo_started) return 'Demo: İşleme Başlandı'
      if (lastHistoryEvent(project) === 'demo_form_edited') return 'Güncel Demo Formu Matbaaya Gönderildi'
      return 'Demo İstendi'
    case 'ozalit_teslim':
      if (!project.ozalit_requested && project.reject_target !== 'matbaa') return null
      if (project.ozalit_fix_pending) return 'Düzeltme Bekleniyor'
      if (project.ozalit_started) return 'Ozalit: İşleme Başlandı'
      if (lastHistoryEvent(project) === 'ozalit_form_edited') return 'Güncel Ozalit Formu Matbaaya Gönderildi'
      return 'Ozalit İstendi'
    default:
      return null
  }
}
