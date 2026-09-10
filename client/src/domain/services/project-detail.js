/**
 * Pure domain helpers for the project detail page.
 *
 * Zero React / API dependencies — every function here is a pure computation
 * over its inputs.  Extracted from ProjectDetail.jsx so the page component
 * (and any future consumer) can import them without pulling in React.
 */
import {
  ORDER_STEP_LABELS,
  isOrderOpen,
  orderStepPath,
} from '../constants/orders.js'
import {
  isLegacyProject,
  canApproveOzalitNow,
  ozalitDecidable,
  ozalitLeaderApproved,
  EARLY_PARCA_STAGES,
} from './pipeline.js'

/**
 * Who the per-parça panel DRAWS for at a given gate.
 *
 * Exported because two places need the same answer and must not drift: the page
 * decides whether to render the panel, and the hook decides whether the header
 * may stop offering the whole-round buttons the panel has taken over. Out of
 * step, somebody is left with no button at all.
 *
 * Wider than `parcaPanelDecider` below, and the demo gate is why. An assigned
 * designer may take delivery of a demo (`canReceiveDemo`) but may not approve
 * one — the server allows only the leader or the matbaa. They still need to SEE
 * the round to take delivery of it, so the panel draws for them; it just offers
 * them nothing to sign.
 *
 * @param {{ role?: string } | null} user
 * @param {'demo' | 'ozalit' | 'baski_onay' | 'cin_baski_onay'} ledgerKind
 * @param {{ isAssigned?: boolean }} [opts]
 */
export function parcaPanelViewer(user, ledgerKind, { isAssigned = false } = {}) {
  if (ledgerKind === 'demo') {
    return user?.role === 'team_leader' || (user?.role === 'designer' && isAssigned)
  }
  if (ledgerKind === 'ozalit') return user?.role === 'team_leader' || user?.role === 'designer'
  return user?.role === 'team_leader'
}

/**
 * Who may take a DECISION on the panel's rows — the per-parça Onayla / Reddedin
 * and the bulk pair.
 *
 * Deliberately NARROWER than `isDemoApprover` / the server's `canApproveAt` on
 * the demo leg, both of which also admit the matbaa. The matbaa never approves
 * anything — their part of the round is teslimat, and their surface is the parça
 * job board. That the server would accept a demo approval from them is a
 * leftover from when the printer's "Teslim Edin" was modelled as the same
 * advance; offering them an Onayla here would put a decision in front of the one
 * role that never takes it. The Approvals queue already gates its demo panel on
 * `isLeader` alone — this brings the project page in line rather than inventing
 * a new rule.
 *
 * Split from `parcaPanelViewer` rather than folded into it because seeing a
 * round and deciding it are different rights, and only at the demo gate do they
 * come apart: an assigned designer takes delivery there and signs nothing.
 *
 * The OZALIT leg does not answer on role alone, and this used to try. Three
 * rules sit between a designer and an ozalit sign-off, all of them enforced by
 * `computeOzalitOnayApproval`:
 *
 *   assigned    — "yalnızca ekip lideri veya atanmış tasarımcı"; any other
 *                 designer is refused outright
 *   leader-first— the ozalit is the leadership's call and a designer only
 *                 COUNTER-signs: until a team leader has signed some parça,
 *                 "Önce ekip lideri onaylamalıdır"
 *   ekran       — a screen round is a flat single-leader sign-off with no
 *                 designer counter-sign at all: "Ekran ozalit onayını yalnızca
 *                 ekip lideri verebilir"
 *
 * `canApproveOzalitNow` is where those three already live — it is what gates the
 * HEADER's Onayla. Role-only here meant the two surfaces disagreed on exactly
 * the rounds this panel exists for: on a multi-parça round the header button is
 * suppressed in favour of the panel, so the only Onayla on screen was the one
 * with the weaker gate. A designer got thumbs-up buttons on an ekran round, or
 * before any leader had signed, and every press returned a 400.
 *
 * `project` is therefore required for the ozalit leg. Without it the answer
 * falls back to leader-only, which is the safe half of the rule rather than the
 * permissive one.
 *
 * @param {{ role?: string, id?: string } | null} user
 * @param {'demo' | 'ozalit' | 'baski_onay' | 'cin_baski_onay'} ledgerKind
 * @param {{ project?: object }} [opts]
 */
export function parcaPanelDecider(user, ledgerKind, { project = null } = {}) {
  /* The EARLY gate first, because it asks a different question (migration 076).
   *
   * At a *_teslim stage the round is still being produced and the panel is
   * deciding parçalar that came back ahead of it. `computeEarlyParcaApproval`
   * gates that on one thing — "Tamamlanmamış turda parça onayını yalnızca ekip
   * lideri yapabilir" — and none of the *_onay gate's rules are even askable
   * yet: there is no project-level receipt to have taken (that happens when the
   * round lands) and no round-level sign-off for a designer to follow.
   *
   * Asking `canApproveOzalitNow` here answers false for the leader too, on the
   * `!ozalit_received` check, and takes the early sign-off away from the one
   * person the server grants it to. */
  if (project && EARLY_PARCA_STAGES.has(project.stage)) {
    if (user?.role === 'team_leader') return true
    // …but the OZALIT leg is multi-party even while the round is unfinished: an
    // assigned designer counter-signs a parça a leader has already signed. The
    // demo leg has no designer sign-off at any point, early or at the gate.
    if (ledgerKind !== 'ozalit') return false
    const assigned = user?.role === 'designer'
      && (project.assignees ?? []).some((a) => a.id === user.id)
    // Panel-level: is there anything here for them yet. Which PARÇA they may
    // sign is the grid's own leader-first check, scoped the way the server
    // scopes it — see signableByViewer.
    return assigned && ozalitLeaderApproved(project)
  }
  if (ledgerKind === 'demo') return user?.role === 'team_leader'
  if (ledgerKind === 'ozalit') {
    // Both roles answer to the same gate the header's Onayla answers to — no
    // second copy of the rules to drift. Without a project to ask it about, only
    // a leader could ever be right, so that is the fallback.
    if (!project) return user?.role === 'team_leader'
    return canApproveOzalitNow(user, project)
  }
  return user?.role === 'team_leader'
}

// ---------------------------------------------------------------------------
// Order helpers
// ---------------------------------------------------------------------------

// "Open" mirrors useOpenOrdersByProject/findOpenByProject — not yet at a
// terminal step. A project can have more than one of these in flight at
// once (concurrent sipariş orders on the same product are allowed), so this
// page shows one stepper per active order rather than assuming there's only
// ever one.
//
// `baskida` counts as ACTIVE since migration 081: the run still owes its
// teslim, and the tracker's last two steps are exactly the ones that happen
// after it.
export const isActiveOrder = (o) => isOrderOpen(o)

// The order's status used to stop at 'baskida', so the tracker faked the rest
// with two derived steps ('teslim_bekleniyor', 'satista') read off the PROJECT.
// Migration 081 made the teslim leg real order state, so the tracker draws
// actual statuses and those two are gone — see OrderProgressStepper for why
// borrowing the project's stage was wrong for a reprint.
export const DISPLAY_ORDER_STEP_LABELS = {
  ...ORDER_STEP_LABELS,
  // Short forms: the stepper gives each step ~40px at 390px, and these are
  // only ever read next to the steps around them.
  kontroller_tamam: 'Kontrol',
  teslim_edildi: 'Teslim',
}

// Mirrors the per-page action labels in MyProjects/SiparisOnay/SiparisTalepleri
// (each only ever renders one of these for its own role's queue) — collected
// here since this page shows a project's orders to whichever role opens it.
// imza_bekleniyor reads as "Onaylayın" here too so the leader sees the same
// verb they saw in the queue card; the receipt gate ("Teslim Alındı" /
// "Teslim Alınamadı") is presented inside the dialog when matbaa_received
// is still false, before the approval click — see TalepSignDialog's
// imza_bekleniyor handling. This keeps the detail page in lock-step with
// SiparisTalepleri so a leader who lands here from the queue doesn't see
// the action verb flip under their feet.
//
// Keys use the post-migration-066 status names. The legacy `pending` /
// `ekran_onay` entries pre-dated the rename; with the server now writing
// `atama_bekleniyor` / `ekran_onayinda`, those rows were silently falling
// through to the `?? 'Onaylayın'` fallback — a team leader on the atama
// step saw "Onaylayın" instead of "Tasarımcıya Aktarın" on the project
// tracker's "Aksiyon bekliyor" chip.
const ORDER_ACTION_LABELS = {
  atama_bekleniyor: 'Tasarımcıya Aktarın',
  tasarimciya_atandi: 'Kontrolleri Yapın',
  kontroller_tamam: 'Ozalit İsteyin',
  matbaa_ozalit_yapiyor: 'Teslim Edin',
  ekran_onayinda: 'Onaylayın',
  imza_bekleniyor: 'Onaylayın',
  baski_onayi_bekleniyor: 'Baskı Onay Formu',
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
export function availableActions({
  project, user, parcaRows = [], printerParcaJobs = [], parcaSnapshot = [],
  parcaSnapshotReady = true,
}) {
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

  // Is this round currently split across desks (migration 074)?
  //
  // While even one parça is out, the WHOLE-ROUND Onayla and Reddet must not be
  // offered. They operate on the round as a unit: the project-level Onayla
  // signs off every parça still pending on the snapshot — including the one
  // sitting with the designer — and the project-level Reddet wipes the
  // per-parça ledger and bounces everything, discarding the sign-offs the
  // leader already gave. Either one silently undoes the split.
  //
  // The parça grid is the surface for a split round; it has its own per-parça
  // Onayla/Reddet, and the whole-round pair comes back the moment every parça
  // is home.
  const splitAcrossDesks = (parcaRows ?? []).some((r) => (
    r?.state === 'with_designer' || r?.state === 'with_matbaa' || r?.state === 'in_round'
  ))

  // The matbaa's half of the same rule.
  //
  // Their whole-sheet "Teslim Edin" is the advance below, and it operates on
  // the round as a unit: `computeDemoTeslimAdvance` moves the project to the
  // onay stage with no parça check at all, while `deliverParca` gates the same
  // move on `allParcalarDelivered`. So on a split round the project-level
  // button carried the round past parçalar that were never produced, leaving
  // their `parca_state` rows stranded at `with_matbaa` and skipping the
  // leader's per-parça receipt entirely.
  //
  // `parcaRows` can't answer this: a first round is split by its snapshot, not
  // by routing rows, and those only exist once something has been sent back
  // (`deriveTeslimParcalar`, server/src/services/parca-service.js). The parça
  // QUEUE is what knows, and one row for this project is enough — the server
  // hands the matbaa a row only when the parça is genuinely theirs to work.
  // ParcaJobBoard is the surface for those, and the whole-sheet pair comes back
  // the moment the queue is empty.
  const printerSplitRound = role === 'printer' && (printerParcaJobs ?? []).length > 0

  /**
   * Is the per-parça panel the surface for DECIDING this round?
   *
   * Whenever the round has a parça list at all — one parça or ten.
   *
   * On a multi-parça round the whole-round Onayla above it is not a shortcut but
   * a way around it: one click signs off every parça the snapshot carries, which
   * is the opposite of deciding them one at a time. The panel already has the
   * shortcut that means it honestly — "Tüm parçaları onaylayın", which knows how
   * many it is signing and refuses to appear when it cannot cover the round.
   *
   * A one-parça round has nothing to go around, and the panel owns it anyway:
   * every decision on a round with a parça list is taken in one place, so nobody
   * has to count a sheet's parçalar to know where its buttons are. Its row opens
   * the same dialogs this header pair did — see ProjectDetail's approveFromPanel.
   *
   * It is also what let the gate close on a parça the round never carried: the
   * header button asks nothing about the project's parça list, so a leader could
   * approve two of three parçalar in one press and land on ozalit with the third
   * never printed. (The server refuses that now — see assertNoNeverSentParcalar —
   * but a button whose only outcome is a 400 is not a button.)
   *
   * `> 0` is the same test ProjectDetail and Approvals use to render the panel at
   * all, so suppression and surface always agree: a legacy round with no snapshot
   * draws no panel, and the header pair is the only way to decide anything there.
   *
   * REJECT keeps its meaning. It is not a per-parça decision wearing the wrong
   * hat — it bounces the whole round for rework, which is a real thing to want
   * and the way out of a round that turned out to be wrong wholesale. Only its
   * home changes, so it is emitted as 'reject-parca' wherever the panel is that
   * home: "Tümünü Reddedin" on a split round, the row's own thumbs-down on a
   * round of one.
   */
  const parcaPanelDecides = (parcaSnapshot ?? []).length > 0
  /* …and until the snapshot has actually been read, we do not know which it is.
   *
   * The list arrives from an async fetch and starts empty, so "not asked yet"
   * and "single-parça round" are the same value for the first paint — and they
   * now imply opposite owners for the whole-round buttons. Offering them on the
   * guess and withdrawing them a moment later is worse than a beat of nothing:
   * it is a button that appears exactly long enough to be clicked. `ready`
   * covers a FAILED read too, so the fallback for a snapshot that cannot be
   * loaded is unchanged. */
  const parcaOwnerUnknown = !parcaSnapshotReady

  if ((stage === 'demo_onay' || stage === 'cin_demo_onay') && role === 'team_leader' && !splitAcrossDesks) {
    // Hide Onayla + Reddet until the demo has been received (Teslim Alındı)
    // and while the demo is held. The leader can't approve/reject a demo
    // they haven't taken delivery of yet, and once held, the project is
    // waiting for the designer to re-send a second demo.
    if (project.demo_received === true && project.demo_held !== true && !parcaOwnerUnknown) {
      if (!parcaPanelDecides) set.add('approve')
      // 'reject' is the header's button, 'reject-parca' the panel's
      // "Tümünü Reddedin" — the same whole-round act, two possible homes, and
      // every gate above decides both. Emitting one name and a separate
      // "where does it live" flag would let the two drift; this way a caller
      // that renders neither name simply doesn't offer the action.
      set.add(parcaPanelDecides ? 'reject-parca' : 'reject')
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
  //
  // An EKRAN OZALIT (migration 061) has no proof and no receipt step, so the
  // receipt flag would gate it shut forever — ozalitDecidable takes the screen
  // round's own flag as the gate instead, and canApproveOzalitNow / the
  // server's reject gate both already carry the "one leader decides a screen
  // round" rule.
  if (ozalitDecidable(project) && !splitAcrossDesks && !parcaOwnerUnknown) {
    const alreadyApproved = (project.ozalit_approvals ?? []).some((a) => a.id === user.id)
    // Each leader/designer approves once. A leader who hasn't decided yet sees
    // both Onayla and Reddet; once they approve, BOTH disappear (they've
    // committed) — a different leader who hasn't approved still sees Reddet.
    // canApproveOzalitNow also carries the leader-first rule: an assigned
    // designer gets no Onayla until a team leader has signed off (the server
    // refuses it too), so the button is never offered as a dead end.
    // Same rule as the demo gate above — the panel is where a multi-parça round
    // is signed off, one parça at a time. Safe for the designer's half of the
    // multi-party sign-off too: ProjectDetail renders the grid at ozalit_onay
    // for `isLeader || designer`, a superset of who gets this button.
    if (canApproveOzalitNow(user, project) && !alreadyApproved && !parcaPanelDecides) {
      set.add('approve')
    }
    if (role === 'team_leader' && !alreadyApproved) {
      set.add(parcaPanelDecides ? 'reject-parca' : 'reject')
    }
  }
  // Baskı Onayı: the final sign-off, team_leader only — same people (Serpil
  // Hanım / Ayşenur, …) who may edit the form itself. Dual-approval
  // (migration 045): the button opens the same dialog whether the form still
  // needs preparing or is awaiting a different leader's approval — see
  // BaskiOnayFormDialog / SpecFormDialog's isBaskiOnayApproval branch for
  // which action it actually performs.
  if ((stage === 'baski_onay' || stage === 'cin_baski_onay') && role === 'team_leader') {
    // Same rule as the demo and ozalit gates: on a multi-parça round the panel
    // owns it. Baskı is the odd one of the three, because this single button
    // carries BOTH of its steps — "Baskı Onayı Hazırlayın" while the form is
    // unprepared, "Baskı Onayı Verin" once it is (approveActionLabel). The panel
    // splits them apart, which is the honest shape: preparing is one act on one
    // document, approving is per parça by a different leader.
    if (!parcaPanelDecides && !parcaOwnerUnknown) set.add('approve')
  }
  if (isAssignedDesigner && stage === 'tasarim') {
    set.add('advance')
  }
  // Ozalit redo leg (post-rejection): the project stayed on ozalit_onay
  // instead of bouncing back to tasarım, so the assigned designer / team
  // leader reopens the route picker (matbaa vs ekran) from this stage.
  // The server refuses an advance with outstanding revize flags, so the
  // action row's disabled-by-pendingRevize watcher keeps the button honest.
  if (
    stage === 'ozalit_onay' &&
    project.last_reject_type === 'ozalit' &&
    (role === 'team_leader' || isAssignedDesigner)
  ) {
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
      if (
        (ozalitRequested || matbaaLock) && project.ozalit_started &&
        !project.ozalit_change_requested_at && !printerSplitRound
      ) {
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
    project.demo_started && !project.demo_change_requested_at && !printerSplitRound
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
  // Ozalit redo leg: the project stays on ozalit_onay with last_reject_type='ozalit'
  // and the designer (or leader) reopens the route picker from the same stage.
  if (
    project.stage === 'ozalit_onay' &&
    project.last_reject_type === 'ozalit'
  ) {
    return "Ozalit'e Gönderin"
  }
  switch (project.stage) {
    case 'tasarim':
      // A design that's back in Tasarım after a demo rejection resubmits to
      // the demo flow.
      return "Demo'ya Gönderin"
    case 'demo_onay':
    case 'cin_demo_onay':
      // Matbaa delivered; leader can approve/reject. The leader or
      // designer can also re-trigger a new demo round.
      return 'Demo İsteyin'
    case 'ozalit_teslim':
      // Leader / assigned designer requesting the ozalit proof.
      return 'Ozalit İsteyin'
    case 'demo_teslim':
      // At demo_teslim the matbaa delivers (printer). The team leader
      // or assigned designer re-triggers a new demo round.
      return userRole === 'printer' ? "Demo'yu Teslim Edin" : 'Demo İsteyin'
    case 'cin_demo_teslim':
      // ÇİN has no matbaa leg: the leader sends the demo that came back from
      // China on to its approval gate (server computeDemoTeslimAdvance).
      return userRole === 'printer' ? "Demo'yu Teslim Edin" : 'Onaya Gönderin'
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
