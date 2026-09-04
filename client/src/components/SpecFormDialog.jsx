import { useEffect, useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DIALOG_MOBILE_SHEET,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import api from '@/api'
import SpecFormFooter from '@/components/SpecFormFooter'
import { SpecChangeSummary, SpecFormGates, SpecFormIntro } from '@/components/SpecFormNotices'
import SpecSheetBody from '@/components/SpecSheetBody'
import { useAuth } from '@/hooks/useAuth'
import { useProjectsStore } from '@/hooks/useProjectsStore'
import { useDesignerCelebration } from '@/hooks/useCelebration'
import { incompleteSpecBlocks } from '@/lib/spec-form-completeness'
import { useSpecSheet } from '@/hooks/useSpecSheet'
import { saveEditedComponents } from '@/data/productCatalog'
import { ozalitLeaderApproved, needsOzalitRouteChoice } from '@/domain'
import { buildChangeSummary } from '@/lib/spec-form-diff'
import { openMultiPrint } from '@/lib/spec-form-print'
import { VARIANTS, computeBaskiOnayLocked, isDemoAlreadyApproved, isRejectToMatbaaReview } from '@/lib/spec-form-variants'
import {
  fetchServerSnapshot,
  loadSaved,
  loadSnapshot,
  missingRequiredFields,
  saveForm,
  saveSnapshot,
  stampSpecSignature,
  stripStamps,
} from '@/lib/spec-form-storage'

/* ------------------------------------------------------------------ */
/*  Sibling files (slice: client god-components)                      */
/* ------------------------------------------------------------------ */
/**
 * This file used to be 2011 lines: the variant table, the two persistence
 * layers, the loader, the diff, the whole sheet and every banner around it.
 * They now live next to it, and it keeps only what it is — the dialog that
 * decides who may do what to a spec sheet, and what each button does:
 *
 *  - `lib/spec-form-variants.js` — the Demo / Ozalit / Baskı Onay table
 *  - `lib/spec-form-storage.js`  — localStorage + /api/demos, and the stamps
 *  - `lib/spec-form-print.js`    — putting the sheet on paper
 *  - `lib/spec-form-diff.js`     — what changed since the matbaa's copy
 *  - `hooks/useSpecSheet.js`     — the sheet's content, and the load that fills it
 *  - `SpecSheetBody.jsx`         — the sheet, rendered
 *  - `SpecFormNotices.jsx`       — intro / diff panel / gate banners
 *  - `SpecFormFooter.jsx`        — the action bar
 *
 * The three names other modules import from here — VARIANTS,
 * specVariantForStage, stampSpecSignature — are re-exported below, so every
 * existing `from '@/components/SpecFormDialog'` keeps working unchanged.
 */
export { VARIANTS, specVariantForStage, computeBaskiOnayLocked, isDemoAlreadyApproved, isRejectToMatbaaReview } from '@/lib/spec-form-variants'
export { stampSpecSignature } from '@/lib/spec-form-storage'

/* ------------------------------------------------------------------ */
/*  Shared spec-sheet dialog                                          */
/* ------------------------------------------------------------------ */

/**
 * Shared Demo / Ozalit spec-sheet dialog. Pick a variant via the `variant`
 * prop ('demo' | 'ozalit'); everything variant-specific lives in VARIANTS.
 *
 * mode:
 *   'advance'  — send the sheet onward (api.advanceProject)
 *   'approve'  — team leader approves and sends to production (api.approveProject; ozalit)
 *   'view'     — edit current saved form
 *   'history'  — read-only snapshot view (requires viewAttempt)
 *
 * viewAttempt — attempt number to load from snapshot (used with mode='history')
 * viewDemoId — exact snapshot row to load, when the timeline row that opened
 *   this dialog recorded one (migration 052). Two corrections of one round
 *   share an attempt slot, so viewAttempt alone always resolves to the later
 *   of them; this addresses the sheet directly. Falls back to viewAttempt for
 *   rows written before the migration.
 * viewAttemptLabel — round number to PRINT on that snapshot. An edit is
 *   stored one slot past its round (see liveAttempts), so a correction to the
 *   1st demo lives at slot 2 and would otherwise open titled "2. Demo" — a
 *   round that hasn't happened, contradicting the "Demo 1" badge on the very
 *   row that opened it. Display only; every lookup still uses viewAttempt.
 * notifyOnSave — mode='view' only. When true, Kaydet also logs a history
 *   entry and notifies the matbaa the sheet changed (see handleSave) instead
 *   of the normal silent in-place save.
 * onStartWork / startingWork — mode='view' only. When onStartWork is passed
 *   (the printer may still mark demo-start/ozalit-start), the footer offers
 *   an "İşlemi Başlatın" button so they review the spec sheet before
 *   confirming they've begun physical work, instead of starting blind.
 * rejectContext — { reason, target } — used with mode='advance' when a
 *   team-leader reject-to-matbaa (ApprovalDialog) hands off here instead of
 *   submitting blind: THIS dialog's submit is what actually calls
 *   api.rejectProject (with the reason already collected), not advanceProject.
 *   The form is opened read-only — the leader reviews but cannot edit it —
 *   and the saved snapshot is left untouched on submit, so the matbaa
 *   receives exactly the file they had when they pressed "İşlemi Başlatın"
 *   (any accidental edit here used to silently rewrite that snapshot and
 *   ship a different file). The saved sheet still loads as-is (like a
 *   read-only viewer would) instead of the normal "fresh compose" reset.
 */
export default function SpecFormDialog({ variant: variantName = 'demo', open, onOpenChange, project, order = null, mode, onDone, viewAttempt, viewAttemptLabel = null, viewDemoId = null, notifyOnSave = false, onStartWork, startingWork = false, rejectContext = null }) {
  const variant = VARIANTS[variantName]
  const { user } = useAuth()
  const { updateOne } = useProjectsStore()
  /* ── Whose ozalit round is this? ────────────────────────────────────────
   * A sipariş (order) runs the SAME sheet as the project's own pipeline —
   * same Baskı Reçeteleri source, same rounds, same İSTEM/TESLİM/ONAY
   * stamps, same print output. It just keeps them under its own id
   * (migration 053) so two concurrent reprints of one title don't share a
   * sheet. `round` is the only place that knows which entity owns the
   * round; everything below reads it instead of reaching into `project`.
   *
   * The reçete itself stays project-scoped on purpose: a reprint is a
   * reprint of the same product, and Ürün Bilgileri / Baskı Reçeteleri is
   * the one catalog both pipelines read and write.
   */
  const orderScoped = !!order
  /* Which route a view-mode save takes — and therefore what the button may
     promise. "Kaydedin" covered two outcomes that have nothing in common: a
     correction the matbaa is told about and starts working from, and a note
     that never leaves this browser. On a phone, where the opening button's
     tooltip is unreachable, the footer was the only place left to say which
     one you were about to do, and it said neither.

     Non-null means the sheet goes to the matbaa (handleSave awaits it before
     anything is written). The label reads from this same value, so the button
     cannot say one thing and do the other. */
  const notifyEdit = !notifyOnSave
    ? null
    // A sipariş's correction goes to its own route, which writes the snapshot
    // inside the transaction that authorizes the edit — same contract, same
    // reason, as the project's (migration 053).
    : orderScoped ? (id, sheet) => api.notifyOrderOzalitEdit(id, sheet)
      : variant.kind === 'demo' ? api.notifyDemoEdit
        : variant.kind === 'ozalit' ? api.notifyOzalitEdit
          // Baskı Onay has no such route: its view-mode save is always local.
          : null
  // Snapshot + localStorage scope. Order ids and project ids never collide,
  // so one key space serves both.
  const scopeId = order?.id ?? project?.id
  const orderId = order?.id ?? null
  const round = orderScoped
    ? {
      attempt: order.ozalit_attempt,
      started: !!order.ozalit_started,
      fixPending: !!order.ozalit_fix_pending,
      received: !!order.matbaa_received,
      receivedBy: order.matbaa_received_by,
      // Leader-first, read off the order's own ledger — the twin of
      // ozalitLeaderApproved(project) on the main pipeline.
      leaderApproved: (order.matbaa_approvals ?? []).some((a) => a.role === 'team_leader'),
      designerIds: Array.isArray(order.assignee_ids) ? order.assignee_ids : [],
    }
    : {
      attempt: project?.[variant.attemptField],
      started: variant.kind === 'demo' ? !!project?.demo_started : !!project?.ozalit_started,
      fixPending: variant.kind === 'demo' ? !!project?.demo_fix_pending : !!project?.ozalit_fix_pending,
      received: !!project?.ozalit_received,
      receivedBy: project?.ozalit_received_by,
      leaderApproved: ozalitLeaderApproved(project),
      designerIds: (project?.assignees ?? []).map((a) => a.id),
    }
  const celebrate = useDesignerCelebration()
  const [busy, setBusy] = useState(false)
  // Ozalit receipt gate (migration 035) — see the block below the effects.
  const [receiving, setReceiving] = useState(false)
  const [receivedLocal, setReceivedLocal] = useState(false)
  const [confirmReceive, setConfirmReceive] = useState(false)
  /* Baskı Onay approve-step edit override (see spec-form-variants.js's
   * baski_onay docblock for the why). Defaults OFF so the form opens
   * locked; the approver clicks "Düzenleyin" in the footer to unlock if
   * they spot something that needs fixing before signing. Reset on every
   * (re)open so a stale unlock from a previous project never carries over. */
  const [baskiOnayEditOverride, setBaskiOnayEditOverride] = useState(false)

  // Matbaa "Başladım" gate (migration 048): once the printer has started
  // physical work, the leader/assigned designer can no longer silently save
  // an edit here — they have to go through "Değişiklik İste" in
  // ProjectDetail.jsx and wait for the matbaa's accept. Scoped to
  // mode==='view' only — the printer's own delivery-stamp edits
  // (mode='advance'/'approve') and history snapshots are unaffected.
  const lockedByStart = mode === 'view' && round.started
  // Migration 049: once the matbaa accepts a change request, the fix is owed
  // and must go through the dedicated notify path (notifyOnSave=true) — the
  // plain "Demo Formu"/"Ozalit Formu" button stays view-only here so there's
  // no silent way to make the fix without the matbaa being told.
  const lockedByFixPending = mode === 'view' && !notifyOnSave && round.fixPending
  /* The one sipariş step whose sheet the DESIGNER writes: "Ozalit İsteyin"
     (order status 'kontroller_tamam', migration 054). VARIANTS.ozalit locks
     designers out because on the project pipeline the team leader is the
     author of that sheet — here the designer IS the requester, and this form
     is the request. Every other order step still arrives read-only for them
     (the matbaa's teslim, the leader's imza_bekleniyor approve), and a history
     snapshot stays read-only for everyone. */
  const authoringOrderOzalit =
    orderScoped && mode === 'advance' && order?.status === 'kontroller_tamam'
  /* Project pipeline post-revize resubmit (migration 061): a project back at
     `tasarim` after an ozalit rejection must declare whether the next check is
     another physical round ('ozalit') or an Ekran Ozalit straight to the leader
     ('ekran'). The server refuses the advance without a route
     (computeAdvance, server/src/domain/transitions.js), so the footer has to
     offer the chooser. Mirrors the existing `authoringOrderOzalit` predicate
     the sipariş resubmit reads — separate paths, same UX contract. */
  const offersProjectOzalitRoute =
    !orderScoped && mode === 'advance' && variantName === 'ozalit'
    && needsOzalitRouteChoice(project)
  /* ── Baskı Onayı dual-approval (migration 045) ────────────────────────────
   * One team leader PREPARES the form; a DIFFERENT team leader gives the
   * actual "Baskı Onayı". The server is the source of truth for "different
   * person" (it also lets a lone remaining leader self-approve rather than
   * strand the project) — this dialog just switches which button it shows
   * based on `baski_onay_prepared`, and lets a server error surface via toast
   * on the rare self-approve-blocked click.
   *
   * Declared up here (not next to `readOnly`) because `baskiOnayLocked`,
   * `SpecFormGates` and `SpecFormFooter` all read them, and JS const has no
   * hoisting — referencing these from `baskiOnayLocked` two blocks below
   * throws a Temporal Dead Zone error during render (minified as
   * "Cannot access 'Ne' before initialization").
   */
  const isBaskiOnayApproval = mode === 'approve' && variantName === 'baski_onay'
  const baskiOnayPrepared = !!project?.baski_onay_prepared
  // Baskı Onay approve step: once the form has been prepared, the approver
  // is signing what was prepared, not authoring. The variant's pure
  // isReadOnly can't express that — `mode='approve'` covers both prepare
  // and approve — so the dialog adds this gate on top. The override lets
  // the approver opt back in to editing if a field really needs a fix
  // before they sign. The formula is in spec-form-variants.js so it's a
  // pure helper and can be tested without mounting this dialog.
  const baskiOnayLocked = computeBaskiOnayLocked({
    isBaskiOnayApproval,
    baskiOnayPrepared,
    editOverride: baskiOnayEditOverride,
  })
  // Demo form past the demo_onay gate: the signed round is a snapshot, not a
  // draft. Locking here stops a designer (or anyone opening the form via
  // mode='view') from silently editing an already-approved demo. mode='history'
  // is already locked via variant.demo.isReadOnly; mode='advance' on a past-
  // approval project isn't a normal flow but is locked too for safety.
  const demoAlreadyApproved =
    variant.kind === 'demo' && isDemoAlreadyApproved(project)
  const readOnly =
    (variant.isReadOnly({ mode, user }) && !authoringOrderOzalit)
    || baskiOnayLocked
    || demoAlreadyApproved
    || lockedByStart
    || lockedByFixPending
    // Reject-to-matbaa: the form is opened so the leader can confirm the
    // rejection after seeing the sheet, NOT so they can edit it. Any edit
    // would ship to the matbaa as a different file than the one they
    // started working from (handleAdvance writes the loaded payload back
    // to the snapshot on submit). Lock it.
    || isRejectToMatbaaReview(rejectContext)
  const printable = variant.canPrint({ user, project, readOnly })
  // The plain "Demo Formu" button (mode='view', no notify) always opens a
  // round that has ALREADY been sent: at demo_onay it's the sheet sitting with
  // the leader, and from ozalit_teslim onward it's the sheet the demo was
  // APPROVED on. It therefore has to reopen exactly as it was sent and signed.
  // The demo variant's restoreSavedOnEdit:false is about composing a NEW
  // round; treating this viewer as composing stamped today's date, the
  // viewer's own name as DEMO İSTEYEN KİŞİ and a blank ONAYLAYAN KİŞİ over the
  // approved sheet — the approval signature stampSpecSignature had just
  // written into that very snapshot. (Ozalit / Baskı Onay already restore via
  // restoreSavedOnEdit, so in practice this only changes demo.)
  // Excluded on purpose: "Gönderilen Demoyu Düzenleyin" (notifyOnSave), whose
  // target is the round's separate edit slot, and mode='advance', which really
  // is a fresh compose.
  const viewingSentSheet = mode === 'view' && !notifyOnSave
  /* Whether the server's teslimat columns describe THIS sheet.
   *
   * They only ever hold the round the project is on right now — every
   * transition that opens a new one nulls them (computeDemoTeslimAdvance,
   * computeDemoNotReceived, computeRejection, the cancels) — so they may be
   * layered onto a sheet that IS that round and no other. 'view' and
   * 'approve' both are. 'advance' is not: it composes the NEXT round (the
   * designer's demo request, the leader's ozalit request, a reject-to-matbaa
   * re-delivery, and the matbaa's own teslim form, which is filled in
   * BEFORE the delivery it stamps), and must open with those boxes empty.
   *
   * A snapshot from Geçmiş qualifies too, as long as it belongs to the round
   * still open: those are corrections of the very sheet on screen, one round's
   * worth of paper with one teslimat on it. An older round's snapshot keeps
   * whatever it was stamped with — the columns no longer describe it.
   * See lib/teslimat.js. */
  const showsLiveTeslimat =
    mode !== 'advance' && (viewAttempt == null || viewAttempt >= (round.attempt ?? 0) + 1)

  // Re-sending a demo from a demo stage bumps demo_attempt on the server at
  // submit time (see server transitions: "Re-send starts a new demo round").
  // While composing that re-send the stored counter is still the *previous*
  // attempt, so naively showing demo_attempt+1 leaves the form one behind —
  // it reads "1. DEMO" on the 2nd demo, "2. DEMO" on the 3rd, etc. Add the
  // extra +1 so the form (and the snapshot it saves) already reflect the
  // number this demo will carry once sent. First demo / post-reject revisions
  // advance from Tasarım (no bump) and the matbaa's delivery isn't a re-send,
  // so those keep demo_attempt+1.
  const DEMO_RESEND_STAGES = new Set(['demo_teslim', 'demo_onay', 'cin_demo_teslim', 'cin_demo_onay'])
  const willResendBump =
    variant.kind === 'demo' &&
    !orderScoped &&
    mode === 'advance' &&
    user?.role !== 'printer' &&
    DEMO_RESEND_STAGES.has(project?.stage)
  // Editing an already-sent round ("Gönderilen Demoyu/Ozaliti Düzenleyin",
  // mode='view' + notifyOnSave) must not overwrite the pristine as-first-sent
  // snapshot at the round's own attempt slot — ProjectHistory's edit-history
  // row (MinorRow) always links to attemptAt+1 so the original stays intact
  // and reopenable. Without this bump, handleSave wrote the edit back into
  // the SAME slot the round was first sent under (both computed the same
  // demo_attempt+1), so the edit silently replaced the original there while
  // the history row's own "+1" lookup found nothing and fell back to a
  // stale/unrelated snapshot — showing the wrong content under a misleading
  // "(N+1. Demo)" title. Bumping here keeps save and that lookup in sync.
  const willEditBump = mode === 'view' && notifyOnSave && viewAttempt == null
  const attemptNo =
    viewAttempt ?? ((round.attempt ?? 0) + (willResendBump || willEditBump ? 2 : 1))
  // Slots that can hold this round's CURRENT sheet. Because an edit-notify
  // save lands one slot past the round's own (willEditBump) and
  // /demo-edit-notify deliberately doesn't bump demo_attempt, the newest
  // content for a round may sit at attemptNo + 1 while attemptNo still holds
  // the as-first-sent snapshot Geçmiş links to. Anything showing an
  // already-sent round must therefore read the newer of the two: the plain
  // "Demo Formu" / "İşlemi Başlatın" viewer and the matbaa's own teslim form
  // both loaded attemptNo alone, so after the leader corrected a sent demo
  // the matbaa started work from — and delivered, re-saving — the pre-edit
  // spec. Excluded: composing a NEW round (its slot is empty by definition,
  // and the lookahead would drag the previous round's edit into a fresh
  // sheet) and the edit dialog itself, whose attemptNo already IS the edit
  // slot.
  const composingNewRound = mode === 'advance' && user?.role !== 'printer'
  const liveAttempts =
    composingNewRound || notifyOnSave ? attemptNo : [attemptNo, attemptNo + 1]

  /* The sheet itself: what is on it, where it was loaded from, and every edit
     made to it. See hooks/useSpecSheet.js — the flags above are the dialog's
     answers to "which round is this, and who may touch it", which is all that
     loader needs from this file. */
  const {
    form, setForm, customRows, selectedComponents, liveAttemptNo, catalogComponents,
    handleChange,
    toggleComponent, selectAllComponents, clearComponents,
    addCustomRow, updateCustomRow, removeCustomRow, moveCustomRow,
    addComponentRow, updateComponentRow, removeComponentRow, moveComponentRow,
  } = useSpecSheet({
    open, variant, project, order, user, mode,
    scopeId, orderId, orderScoped,
    viewAttempt, viewDemoId, notifyOnSave, rejectContext,
    readOnly, viewingSentSheet, showsLiveTeslimat,
    attemptNo, liveAttempts,
  })

  // Empty for every variant but baski_onay — see missingRequiredFields. Each
  // write path below refuses while it is non-empty, and the footer disables
  // its actions with the reason spelled out rather than only toasting on click.
  //
  // `specBlocks` is what carries the sheet's spec: the selected parçalar, or
  // the single custom-row body a project with no catalog falls back to. Both
  // the ADET gate and the completeness gate below read it.
  const specBlocks = selectedComponents.length > 0
    ? selectedComponents
    : [{ component: form.isinAdi, rows: customRows }]
  const missingRequired = missingRequiredFields(variant, form, specBlocks)
  function requiredFilled() {
    if (missingRequired.length === 0) return true
    toast.error(`${missingRequired.join(' ve ')} boş bırakılamaz.`)
    return false
  }

  /**
   * The Demo / Ozalit send gate: a sheet may not be REQUESTED while its
   * parçalar are still the empty template (see lib/spec-form-completeness.js).
   *
   * Only for someone composing the sheet. The matbaa delivering it is
   * read-only and could not fix an incomplete spec if it wanted to, and
   * "Reddedin ve Gönderin" confirms a rejection rather than composing
   * anything — the same two exemptions the required-field gate makes.
   */
  const incompleteSpec = variant.requiresFilledSpec && !readOnly && !rejectContext
    ? incompleteSpecBlocks(specBlocks)
    : []
  function specFilled() {
    if (incompleteSpec.length === 0) return true
    toast.error(`Form boş satırlarla gönderilemez — ${incompleteSpec[0]}.`)
    return false
  }
  // Saves go back to the slot the sheet was READ from, not blindly to
  // attemptNo. When the live sheet is the edit slot, the matbaa's teslim
  // stamps (handleAdvance) would otherwise land on attemptNo and overwrite
  // the as-first-sent snapshot — which is precisely the row Geçmiş's
  // "Demoya Gönderildi" reopens. The before/after pair the timeline shows
  // (original on the major row, correction on "Demo Formu Güncellendi") only
  // survives if each stays in its own slot. Composing a new round always
  // resolves to attemptNo, so this is a no-op there.
  const writeAttempt = liveAttemptNo ?? attemptNo
  // What the sheet CALLS this round, as opposed to where it's stored.
  const shownAttemptNo = viewAttemptLabel ?? attemptNo

  /**
   * Baseline for the "Değişiklikler" diff panel (migration 049) — a snapshot
   * of what the matbaa currently has, captured once when the dedicated
   * "Gönderilen Demoyu/Ozaliti Düzenleyin" button opens the dialog. Only
   * meaningful there (notifyOnSave=true); left null otherwise so the panel
   * never renders on the plain view/edit path. Deliberately a fresh fetch
   * rather than reusing the state the load effect above sets — that effect
   * merges in fresh-form defaults for non-editable system fields, which
   * would show up as false "changes".
   */
  const [baseline, setBaseline] = useState(null)
  useEffect(() => {
    if (!open || !project?.id || !notifyOnSave) { setBaseline(null); return }
    let cancelled = false
    ;(async () => {
      const current =
        (await fetchServerSnapshot(variant, project.id, attemptNo, orderId)) ??
        loadSnapshot(variant, scopeId, attemptNo)
      if (cancelled) return
      const carried =
        loadSaved(variant, scopeId) ??
        (await fetchServerSnapshot(variant, project.id, null, orderId))
      if (cancelled) return
      const data = current ?? stripStamps(carried)
      setBaseline({
        customRows: data?.customRows ?? [],
        selectedComponents: data?.selectedComponents ?? null,
      })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scopeId, notifyOnSave])

  const changeSummary = useMemo(
    () => buildChangeSummary(baseline, { customRows, selectedComponents, catalogComponents }),
    [baseline, customRows, selectedComponents, catalogComponents],
  )

  // True when the user opened this dialog via "Gönderilen Demoyu/Ozaliti
  // Düzenleyin" and hasn't actually changed anything yet — once `baseline`
  // finishes loading AND the live rows match it, the "Düzeltmeyi Matbaaya
  // Gönderin" button stops being meaningful: there is nothing to send. The
  // handleSave guard below is the real fix; this flag also disables the
  // button and updates its label, so the user sees the affordance is a no-op
  // instead of being told after the fact.
  const noChangesToSend =
    notifyEdit && changeSummary !== null && changeSummary.length === 0

  /* ── Ozalit "Teslim Alındı" gate ──────────────────────────────────────────
   * The ozalit approve is refused server-side until the physical proof has
   * been acknowledged (migration 035), so this dialog — which is where the
   * Onaylar page and the project detail both sign off — has to offer the
   * acknowledgment inline rather than bouncing the user with an error toast.
   * Same shape as ApprovalDialog's demo gate; `receivedLocal` reflects a click
   * made in this session, before the parent re-passes the updated project.
   */
  const isOzalitApproval = mode === 'approve' && variantName === 'ozalit'
  const ozalitReceived = round.received || receivedLocal
  const needsOzalitReceive = isOzalitApproval && !ozalitReceived
  const canAckOzalit =
    user?.role === 'team_leader' ||
    (user?.role === 'designer' && round.designerIds.includes(user?.id))

  /* ── Ozalit leader-first gate ─────────────────────────────────────────────
   * The second ordering rule on the same approve: a designer counter-signs an
   * ozalit only after a team leader has approved it (computeOzalitOnayApproval
   * refuses otherwise). Nothing for the designer to click here — unlike the
   * receipt gate, they can't open it themselves — so the button is disabled
   * with the reason spelled out.
   */
  const ozalitAwaitingLeader =
    isOzalitApproval && user?.role === 'designer' && !round.leaderApproved

  // Each (re)open starts from the project's own state — a stale local ack
  // would otherwise unlock the button for the next project opened.
  useEffect(() => {
    if (!open) return
    setReceivedLocal(false)
    setConfirmReceive(false)
    setBaskiOnayEditOverride(false)
  }, [open, scopeId])

  async function handleReceiveOzalit() {
    if (!project) return
    setReceiving(true)
    try {
      // Same gate, two ledgers: projects.ozalit_received (migration 035) and
      // order_requests.matbaa_received (migration 038).
      const updated = orderScoped
        ? await api.matbaaReceiveOrder(order.id)
        : await api.receiveOzalit(project.id)
      if (!orderScoped) updateOne(updated)
      // The ack IS the TESLİM ALAN KİŞİ row. Onto the open sheet first, so the
      // approve that usually follows persists it with everything else, and
      // into the round's snapshot so Geçmiş can reopen this sheet signed.
      setForm((f) => ({ ...f, teslimAlanKisi: user?.name ?? '' }))
      stampSpecSignature(variantName, project, { teslimAlanKisi: user?.name ?? '' }, { order })
        .catch(() => {})
      setReceivedLocal(true)
      setConfirmReceive(false)
      toast.success('Ozalit teslim alındı.')
      onDone?.(updated)
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setReceiving(false)
    }
  }

  /**
   * Mirror the snapshot to the server so any browser can reopen it. Resolves
   * to the created row (or null if the POST failed) — handleSave needs its id
   * to stamp the timeline row, everyone else can ignore it.
   */
  function snapshotPayload(data) {
    return { ...data, _customRows: customRows, _selectedComponents: selectedComponents ?? null }
  }

  function persistServerSnapshot(attempt, data) {
    return api.createDemo({
      project_id: project.id,
      // NULL for the project's own round, the sipariş's id for its own
      // (migration 053) — this is what keeps two concurrent reprints of one
      // title off each other's sheet.
      order_id: orderId,
      kind: variant.kind,
      attempt,
      silent: true,
      payload: snapshotPayload(data),
    }).catch(() => null /* localStorage still has it; don't block the flow */)
  }

  // Write any edits made in the side-by-side parça cards back to Ürün Bilgileri
  // (the shared, server-side catalog) so a change made while requesting a demo
  // updates the product spec everywhere — and records who changed it. No-op in
  // read-only mode or for projects without a catalog.
  async function persistCatalogEdits() {
    if (readOnly || !catalogComponents.length || !selectedComponents?.length) return
    // The SAYFA SAYISI row is owned by project düzenleme (the "Toplam iç
    // sayfa" input) — the spec form renders it read-only and the resolver
    // has already filled it with the live total_pages. Round-tripping it
    // back into product_info here would freeze whatever the current count
    // happens to be and sever the live link: next time a designer adds or
    // removes pages, the recipe would still print the old number. Strip it
    // from the write so product_info keeps the seeded 'auto' placeholder
    // and the resolver stays authoritative. Without İç Sayfalar on the
    // project, the row is user-owned and goes through untouched.
    const livePageCount = (project?.subtasks ?? []).some(
      (s) => s.kind === 'pages' && Number(s.total_pages) > 0,
    )
    const componentsToSave = livePageCount
      ? selectedComponents.map((c) => ({
          ...c,
          rows: (c.rows ?? []).filter(
            (r) => String(r.label ?? '').trim().toUpperCase() !== 'SAYFA SAYISI',
          ),
        }))
      : selectedComponents
    try { await saveEditedComponents(project.id, componentsToSave) } catch { /* non-blocking */ }
  }

  /**
   * Everything a successful step writes that ISN'T the step itself: the local
   * form cache, the round's snapshot slot, and the shared Ürün Bilgileri
   * catalog.
   *
   * Called AFTER the transition resolves, never before. These three used to
   * run first, so a transition the server refused — wrong stage, a stale
   * version, the matbaa having started — still left the edit committed
   * everywhere the app reads from, with only a toast to say the "notify"
   * half had failed. The transition is the authorization; nothing may be
   * written until it has passed.
   */
  async function persistAfterStep(payload, { catalog = true } = {}) {
    saveForm(variant, scopeId, payload, customRows, selectedComponents)
    saveSnapshot(variant, scopeId, writeAttempt, payload, customRows, selectedComponents)
    await persistServerSnapshot(writeAttempt, payload)
    if (catalog) await persistCatalogEdits()
  }

  /**
   * `routeOverride` is the sipariş resubmit choice: once an order has bounced
   * back to the designer (order.last_reject_type === 'designer'), the ozalit
   * request may go to the matbaa for another physical proof (the default,
   * 'matbaa_ozalit_yapiyor') or to the team leader as a digital Ekran Onayı
   * ('ekran_onayinda'). The server refuses a route on a first submission, so it
   * is only ever sent when the footer actually offered the choice.
   */
  async function handleAdvance(routeOverride = null) {
    if (!project) return
    // Reject-to-matbaa confirms the rejection without composing a new spec:
    // the form is read-only and the saved snapshot stays untouched. A blank
    // ADET in the original file is the matbaa's to deal with on redelivery,
    // not the leader's to refuse — skip the required-field gate so the
    // "Reddedin ve Gönderin" button stays enabled for a real re-delivery.
    if (!rejectContext && !requiredFilled()) return
    if (!specFilled()) return
    setBusy(true)
    try {
      // When the printer (matbaa) is the one advancing, stamp the
      // "teslim eden kişi" + "teslim tarihi" now. The original requester
      // stamp is preserved from the first save.
      //
      // The teslim IS the matbaa's signature on this sheet, so stamp
      // matbaaYetkilisi here too rather than trusting whatever was pre-filled:
      // the value loaded into `form` comes from a payload someone else saved,
      // and an earlier round's blank would otherwise ship an unsigned sheet.
      let payload = form
      if (user?.role === 'printer') {
        const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
        payload = {
          ...form,
          teslimEdenKisi: user?.name ?? '',
          teslimTarihi: today,
          matbaaYetkilisi: user?.name ?? '',
        }
      } else if (variant.kind === 'ozalit') {
        // Requesting the ozalit — the first ask or a resubmit after an
        // ozalit rejection — is always the current user's ask, even though
        // the field is read-only for designers and may still carry a
        // previous round's name from the loaded snapshot.
        payload = { ...form, [variant.personField]: user?.name ?? form[variant.personField] }
      }
      // The one write that must go BEFORE the transition, not after it. The
      // reçete is the designer's to edit because of the step they are ON
      // (kontroller_tamam — see PUT /product-info's designer window), and this
      // advance is what ends that step. Posted afterwards, like every other
      // path here does it, it would arrive against an order already at
      // matbaa_ozalit_yapiyor and take a 403 that saveComponentsForProject swallows
      // as "offline": the parça edits would ship on the sheet and silently
      // never reach Baskı Reçeteleri. A refused advance leaves a reçete edit
      // the designer was entitled to make either way.
      if (authoringOrderOzalit) await persistCatalogEdits()
      // A sipariş's ozalit walks its own step machine (tasarimciya_atandi →
      // matbaa_ozalit_yapiyor → imza_bekleniyor), but the click, the stamps and the
      // sheet it writes are the project pipeline's. expectedVersion carries
      // the order's optimistic lock so a second signer can't be silently
      // overwritten — the same guard TalepSignDialog uses.
      const updated = orderScoped
        ? await api.advanceOrderRequest(order.id, {
          expectedVersion: order.version ?? null,
          ...(routeOverride ? { route: routeOverride } : {}),
        })
        : rejectContext
          ? await api.rejectProject(project.id, rejectContext.reason, [], rejectContext.target)
          // The project pipeline's post-revize resubmit picks between another
          // physical round ('ozalit') and an Ekran Ozalit straight to the
          // leader ('ekran') through this same footer — see offersProjectOzalitRoute
          // above. A null route is fine everywhere else: the HTTP repo only
          // includes the field in the body when truthy.
          : await api.advanceProject(project.id, offersProjectOzalitRoute ? routeOverride : null)
      // Reject-to-matbaa: the form is read-only and we're not composing a
      // new spec, so the saved snapshot must stay exactly as the matbaa
      // had it when they pressed İşlemi Başlatın. Skip the localStorage +
      // server snapshot writes; the rejection transition is the only thing
      // this click is doing.
      if (!rejectContext) {
        await persistAfterStep(payload, { catalog: !authoringOrderOzalit })
      }
      if (!orderScoped) updateOne(updated)
      toast.success(
        rejectContext ? 'Reddedildi, matbaaya yeniden gönderildi.'
          // The designer's own request step names what it just asked for —
          // "Ozalit onaya gönderildi" would describe the round that hasn't
          // been printed yet, and says nothing at all about the Ekran Onayı
          // route this same button can take on a resubmit.
          : authoringOrderOzalit
            ? routeOverride === 'ekran_onayinda'
              ? 'Ekran onayı istendi, ekip liderine gönderildi.'
              : 'Ozalit istendi, matbaaya gönderildi.'
            // Project pipeline's post-revize resubmit: same two outcomes as
            // the sipariş above, same wording — the screen route skips the
            // matbaa entirely (and the one-leader sign-off downstream — see
            // computeApproval's ekran_ozalit branch), the physical route
            // lands on ozalit_teslim like a normal first request.
            : offersProjectOzalitRoute && routeOverride === 'ekran'
              ? 'Ekran ozalit istendi, ekip liderine gönderildi.'
              : offersProjectOzalitRoute && routeOverride === 'ozalit'
                ? 'Ozalit istendi, matbaaya gönderildi.'
                : variant.advanceToast(project),
      )
      // The sipariş's ozalit request is where the designer's work actually
      // leaves their desk (the checks step before it is only half a turn), so
      // it celebrates even though the project pipeline's ozalit send doesn't.
      if (!rejectContext && (variant.celebrateOnAdvance || authoringOrderOzalit)) celebrate()
      onDone?.(updated)
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally { setBusy(false) }
  }

  async function handleApprove() {
    if (!project) return
    // Belt-and-braces — the Onaylayın button is already disabled while a
    // required field is blank. On the ozalit the sheet is read-only in this
    // mode, so an incomplete one can't be completed here at all; the banner
    // above the footer sends the leader to Reddedin → matbaa instead. On the
    // Baskı Onay Formu (which a leader does author) it stays a live guard.
    if (!requiredFilled()) return
    setBusy(true)
    try {
      // Stamp the real approver at the moment approval actually happens —
      // this is the only point where "onaylayanKisi" should get a value.
      const approvedForm = { ...form, onaylayanKisi: user?.name ?? '' }
      // imza_bekleniyor is the sipariş's ozalit_onay: multi-party, leader-first,
      // and it rides the same /advance route one vote at a time — so a click
      // here doesn't always complete the round (see the toast below).
      const updated = orderScoped
        ? await api.advanceOrderRequest(order.id, { expectedVersion: order.version ?? null })
        : await api.approveProject(project.id)
      await persistAfterStep(approvedForm)
      if (!orderScoped) updateOne(updated)
      // Three outcomes, three messages. The project path used to claim
      // "üretime alındı" for every one of them, which was wrong twice over: an
      // ozalit approve is a single vote in a multi-party round
      // (computeOzalitOnayApproval), so the common case is that NOTHING moved
      // and the leader is one of several still to sign — and even a completed
      // round lands on baski_onay, a further dual-signature gate, not
      // production. The sipariş path already told the truth; this reads the
      // same signal off the project (stage unchanged = round still open) so
      // both say the same thing.
      const stillCollecting = orderScoped
        ? updated.status === order.status
        : updated.stage === project.stage
      toast.success(
        stillCollecting ? 'Onayınız kaydedildi, diğer onaylar bekleniyor.'
          : isBaskiOnayApproval ? 'Baskı onaylandı, proje baskıya alındı.'
            : 'Ozalit onaylandı, baskı onay formuna gönderildi.',
      )
      onDone?.(updated)
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally { setBusy(false) }
  }

  /**
   * Baskı Onayı dual-approval, maker half: saves the form as-is and marks it
   * "hazırlandı" — this does NOT advance the project. It stays at baski_onay
   * until a different team leader approves (handleApprove above, once
   * `baski_onay_prepared` is true).
   */
  async function handlePrepareBaskiOnay() {
    if (!project) return
    if (!requiredFilled()) return
    setBusy(true)
    try {
      const updated = await api.prepareBaskiOnay(project.id)
      await persistAfterStep(form)
      updateOne(updated)
      toast.success('Baskı onay formu hazırlandı, başka bir ekip liderinin onayı bekleniyor.')
      onDone?.(updated)
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally { setBusy(false) }
  }

  async function handleSave() {
    if (!project || busy) return
    // Applies to the plain save too: a draft parked with a blank ADET /
    // BASIM YERİ is exactly what the next reader picks up and sends on.
    if (!requiredFilled()) return
    // The completeness gate is about SENDING, so a plain Kaydet stays open —
    // a leader parks a half-filled ozalit and comes back to it, and blocking
    // that would make the templates worse than the blank sheet they replaced.
    // `notifyEdit` is the save that ships the revised sheet to the matbaa
    // (the "Gönderilen Demoyu/Ozaliti Düzenleyin" path), and that is a send.
    if (notifyEdit && !specFilled()) return
    // Guard the "Gönderilen Demoyu/Ozaliti Düzenleyin" path against an empty
    // submit. Opening this dialog and pressing Kaydet without editing used to
    // write a history row and notify the matbaa with nothing to review — every
    // leader who double-clicked the menu item produced a phantom "Değişiklik
    // Kabul Edildi"-shaped noise event. Once `baseline` has loaded, an empty
    // changeSummary means the live sheet still matches what the matbaa has;
    // closing here costs nothing. `changeSummary === null` (baseline still
    // loading) is allowed through — the button stays enabled while the
    // dialog opens — so a fast typist isn't blocked by an in-flight fetch.
    if (notifyEdit && changeSummary && changeSummary.length === 0) {
      toast.info('Değişiklik yapılmadı, matbaaya bildirim gönderilmedi.')
      onOpenChange(false)
      return
    }
    // Unlike every other handler here (handleAdvance/handleApprove/
    // handlePrepareBaskiOnay), this one used to have no busy guard — a rapid
    // double-click fired handleSave twice before the first call's await
    // chain finished and closed the dialog, each producing its own
    // notifyDemoEdit call and its own Geçmiş row for what was one save.
    setBusy(true)
    try {
      const notify = notifyEdit
      if (notify) {
        // Correcting an already-sent round. NOTHING is written until the
        // server has authorized it: the route inserts the snapshot inside
        // the same transaction as computeDemoEdit/computeOzalitEdit.
        //
        // This used to save the sheet through POST /demos first and only
        // then call notify, catching the refusal as "kaydedildi ama matbaa
        // bilgilendirilemedi". That message was wrong about which half
        // failed — the edit was live, and the matbaa (who had meanwhile hit
        // "İşlemi Başlatın") went on working from the sheet they started
        // while everyone else saw the corrected one, with no timeline row
        // and no notification, because this very call is what writes both.
        let updated
        try {
          updated = await notify(scopeId, { attempt: writeAttempt, payload: snapshotPayload(form) })
        } catch (err) {
          // Re-read the project so the stale "Gönderilen ... Düzenleyin"
          // button this save came from gives way to "Değişiklik İsteyin".
          // The sipariş's own row is refreshed by its parent's onDone
          // instead — there's no orders store to update in place.
          if (!orderScoped) {
            try { updateOne(await api.getProject(project.id)) } catch { /* the error below is the point */ }
          }
          toast.error(err.message || 'Form güncellenemedi.')
          return
        }
        saveForm(variant, scopeId, form, customRows, selectedComponents)
        await persistCatalogEdits()
        if (!orderScoped) updateOne(updated)
        // The sipariş has no store to write through — hand the fresh row back
        // so the page that opened this dialog re-renders on it.
        if (orderScoped) onDone?.(updated)
        toast.success(`${variant.title} güncellendi, matbaa bilgilendirildi.`)
      } else if (mode === 'view') {
        // Plain viewer ("Demo Formu" / "Ozalit Formu" / "Baskı Onay Formu"
        // buttons) edits are personal — localStorage only. Nothing is written
        // to the snapshot server, so the printer keeps working from the
        // originally sent sheet. To push a change to the printer, use the
        // explicit "Gönderilen Demoyu Düzenleyin" / "Gönderilen Ozaliti
        // Düzenleyin" button (notifyOnSave), which logs a history row and
        // notifies the matbaa. Ürün Bilgileri catalog edits are skipped here
        // for the same reason — they're shared data the printer reads from,
        // and a personal draft shouldn't leak into them.
        saveForm(variant, scopeId, form, customRows, selectedComponents)
        toast.success('Taslak kaydedildi.')
      } else {
        // Compose / approve / etc.: existing silent save path (draft on
        // server, no history row, no push).
        saveForm(variant, scopeId, form, customRows, selectedComponents)
        await persistServerSnapshot(writeAttempt, form)
        await persistCatalogEdits()
        toast.success(variant.saveToast)
      }
      onOpenChange(false)
    } finally { setBusy(false) }
  }

  function handlePrint() {
    if (!project) return
    // A printout is the sheet leaving the app — same bar as sending it.
    if (!readOnly && !requiredFilled()) return
    if (!readOnly) {
      saveForm(variant, scopeId, form, customRows, selectedComponents)
      persistCatalogEdits()
    }
    openMultiPrint({ form, customRows, project, attemptNo: shownAttemptNo, kind: variant.kind, selectedComponents })
  }

  if (!project) return null

  // Demo: system-driven fields must never be editable; Ozalit: they follow readOnly.
  const systemRowReadOnly = variant.systemFieldsEditable ? readOnly : true

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Radix focuses the first focusable element on open — here that's the
        // İŞİN ADI input, and browsers render focused-input text as selected,
        // so the sheet opened with the title looking "highlighted". Keep
        // focus on the dialog itself instead.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn('max-w-2xl', DIALOG_MOBILE_SHEET)}>
        {/* The sheet below carries its own title block, so on paper this
            would print the form's name twice. */}
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {variant.title}
            {readOnly && <span className="ml-1 text-xs font-normal text-muted-foreground">({shownAttemptNo}. {variant.attemptWord})</span>}
          </DialogTitle>
        </DialogHeader>

        <SpecFormIntro
          authoringOrderOzalit={authoringOrderOzalit}
          order={order}
          rejectContext={rejectContext}
          projectResubmitOzalit={offersProjectOzalitRoute}
        />

        <SpecChangeSummary changeSummary={changeSummary} />

        <SpecSheetBody
          variant={variant}
          project={project}
          user={user}
          form={form}
          onChange={handleChange}
          readOnly={readOnly}
          systemRowReadOnly={systemRowReadOnly}
          shownAttemptNo={shownAttemptNo}
          customRows={customRows}
          onAddCustomRow={addCustomRow}
          onUpdateCustomRow={updateCustomRow}
          onRemoveCustomRow={removeCustomRow}
          onMoveCustomRow={moveCustomRow}
          catalogComponents={catalogComponents}
          selectedComponents={selectedComponents}
          onToggleComponent={toggleComponent}
          onSelectAllComponents={selectAllComponents}
          onClearComponents={clearComponents}
          onAddComponentRow={addComponentRow}
          onUpdateComponentRow={updateComponentRow}
          onRemoveComponentRow={removeComponentRow}
          onMoveComponentRow={moveComponentRow}
        />

        <SpecFormGates
          variant={variant}
          project={project}
          user={user}
          round={round}
          readOnly={readOnly}
          isOzalitApproval={isOzalitApproval}
          ozalitReceived={ozalitReceived}
          ozalitAwaitingLeader={ozalitAwaitingLeader}
          canAckOzalit={canAckOzalit}
          confirmReceive={confirmReceive}
          onConfirmReceive={() => setConfirmReceive(true)}
          onCancelReceive={() => setConfirmReceive(false)}
          onReceiveOzalit={handleReceiveOzalit}
          receiving={receiving}
          isBaskiOnayApproval={isBaskiOnayApproval}
          baskiOnayPrepared={baskiOnayPrepared}
          lockedByStart={lockedByStart}
          lockedByFixPending={lockedByFixPending}
          onStartWork={onStartWork}
          missingRequired={missingRequired}
          incompleteSpec={incompleteSpec}
        />

        <SpecFormFooter
          variant={variant}
          user={user}
          order={order}
          mode={mode}
          busy={busy}
          readOnly={readOnly}
          printable={printable}
          missingRequired={missingRequired}
          incompleteSpec={incompleteSpec}
          onClose={() => onOpenChange(false)}
          onPrint={handlePrint}
          onSave={handleSave}
          notifyEdit={notifyEdit}
          noChangesToSend={noChangesToSend}
          onStartWork={onStartWork}
          startingWork={startingWork}
          authoringOrderOzalit={authoringOrderOzalit}
          offersOzalitRoute={offersProjectOzalitRoute}
          rejectContext={rejectContext}
          onAdvance={handleAdvance}
          isBaskiOnayApproval={isBaskiOnayApproval}
          baskiOnayPrepared={baskiOnayPrepared}
          baskiOnayEditOverride={baskiOnayEditOverride}
          onToggleBaskiOnayEdit={() => setBaskiOnayEditOverride((v) => !v)}
          onPrepareBaskiOnay={handlePrepareBaskiOnay}
          needsOzalitReceive={needsOzalitReceive}
          ozalitAwaitingLeader={ozalitAwaitingLeader}
          onApprove={handleApprove}
        />
      </DialogContent>
    </Dialog>
  )
}
