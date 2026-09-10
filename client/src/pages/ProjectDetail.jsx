import { useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  AlertTriangle,
} from 'lucide-react'

import { toast } from 'sonner'

import api, {
  STAGE_LABELS, IN_FLIGHT_DEMO_OZALIT_STAGES,
} from '@/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import ApprovalDialog from '@/components/ApprovalDialog'
import ConfirmDialog from '@/components/ConfirmDialog'
import NewProjectDialog from '@/components/NewProjectDialog'
import OzalitFormDialog from '@/components/OzalitFormDialog'
import BaskiOnayFormDialog from '@/components/BaskiOnayFormDialog'
import DemoFormDialog from '@/components/DemoFormDialog'
import TalepSignDialog from '@/components/TalepSignDialog'
import SiparisBaskiOnayFormDialog from '@/components/SiparisBaskiOnayFormDialog'
import EkranDemoRejectDialog from '@/components/EkranDemoRejectDialog'
import ProjectHistory from '@/components/ProjectHistory'
import ParcaApprovalGrid from '@/components/ParcaApprovalGrid'
import ParcaJobBoard from '@/components/ParcaJobBoard'
import ParcaChangeRequestPanel from '@/components/ParcaChangeRequestPanel'
import { resolveSheetScope } from '@/lib/spec-form-scope'
import ParcaRejectDialog from '@/components/ParcaRejectDialog'
import ParcaReturnedPanel from '@/components/ParcaReturnedPanel'
import {
  orderOzalitFormMode, earlyParcaGateOpen, roundParcaRows,
  EARLY_PARCA_STAGES, isOzalitRoundLive, awaitsOzalitReceipt,
} from '@/domain'
import { parcaPanelViewer, parcaPanelDecider } from '@/domain/services/project-detail'

import { useProjectDetail } from '@/hooks/useProjectDetail'
import { parcaRoundDecidable } from '@/hooks/useParcaSnapshot'
import ProjectDetailHeader from '@/components/ProjectDetailHeader'
import DesignerPanel from '@/components/DesignerPanel'
import SubtaskCard from '@/components/SubtaskCard'

/**
 * Project detail page — thin composition layer.
 *
 * All data-fetching, state management, and mutation logic lives in
 * `useProjectDetail`.  UI sections are extracted into dedicated components:
 *   - ProjectDetailHeader  (header card, action buttons, banners, progress)
 *   - DesignerPanel        (designer sidebar card)
 *   - SubtaskCard          (subtask list + page chip grid)
 *
 * This file only wires them together and renders the dialog shells.
 */
export default function ProjectDetail() {
  const { id } = useParams()
  const d = useProjectDetail(id)
  const {
    project, loading,
    user, isAssigned, isLeader,
    setDialog, setProject, refetch,
    dialog, editOpen, setEditOpen, deleteOpen, setDeleteOpen, deleting,
    ozalitFormOpen, setOzalitFormOpen, ozalitFormMode, ozalitFormAttempt, ozalitFormRound, ozalitFormSnapshot, ozalitFormNotify, ozalitFormStartWork,
    demoFormOpen, setDemoFormOpen, demoFormMode, demoFormAttempt, demoFormRound, demoFormSnapshot, demoFormNotify, demoFormStartWork,
    baskiOnayFormOpen, setBaskiOnayFormOpen, baskiOnayFormMode,
    ekranDemoRejectOpen, setEkranDemoRejectOpen,
    signOrder, setSignOrder, siparisBaskiOnayOrder, setSiparisBaskiOnayOrder,
    ozalitRequestOrder, setOzalitRequestOrder,
    teslimConfirm, setTeslimConfirm,
    receiving, reportingNotReceived, cancellingRequest, respondingChange, processingEkranDemo,
    historyWithAttempts,
    handleOrderSigned, handleOrderUpdated, handleOrderOzalitRequested, handleSiparisBaskiOnayApproved,
    confirmDeleteProject, onActionDone,
  } = d

  // Per-parça approval (migrations 068/069/070) — the same grid the Onaylar
  // queue shows, on the project's own page. It renders on every round whose
  // snapshot lists parçalar — one or several — and is where that round is
  // decided: the header's Onayla/Reddet stay only for a legacy round with no
  // snapshot. A round of one is still decided as the round; see
  // singleParcaRound below.
  //
  // Loaded by useProjectDetail rather than here: the header's "Kalan Parçaları
  // Gönderin" needs the same snapshot to work out which parçalar the round left
  // behind, and two callers would fetch it twice.
  const { parcaSnapshot, ledgerKind } = d
  // Which parçalar the reject dialog is open for; null = closed.
  const [parcaReject, setParcaReject] = useState(null)

  // Sheet-first for per-parça decisions.
  //
  // The rule everywhere else in this app: you see the sheet before you commit
  // to it. The matbaa's İşlemi Başlatın has never been a bare confirm, and at
  // ozalit_onay / baski_onay the leader's project-level Onayla opens the form
  // to sign. The per-parça buttons were the exception — thumbs-up posted
  // straight to the API — which meant a leader could sign off KUTU without
  // ever looking at what KUTU is. This closes that.
  //
  // { action: 'approve' | 'reject' | 'review', parcalar: string[] }
  const [parcaSheet, setParcaSheet] = useState(null)
  // The parça whose sheet the designer has read; only then are the two route
  // buttons offered. Cleared once they pick one.
  const [reviewedParca, setReviewedParca] = useState(null)

  // `wholeRound`: opened on a one-parça round, where the decision is the
  // round's rather than the parça's — the footer then hands off to the dialog
  // the header's Onayla / Reddet used to open. See approveFromPanel.
  function openParcaSheet(action, parcalar, { wholeRound = false } = {}) {
    setParcaSheet({ action, parcalar: parcalar ?? [], wholeRound })
    // The gate decides which sheet — the same variant the round was authored in.
    // Baskı Onayı has its own. It used to fall through to the demo sheet, so a
    // leader signed KUTU's baskı onayı off a different document from the one
    // being approved.
    if (ledgerKind === 'ozalit') {
      d.setOzalitFormMode('view'); d.setOzalitFormAttempt(null); setOzalitFormOpen(true)
    } else if (ledgerKind === 'baski_onay' || ledgerKind === 'cin_baski_onay') {
      d.setBaskiOnayFormMode('view'); setBaskiOnayFormOpen(true)
    } else {
      d.setDemoFormMode('view'); d.setDemoFormAttempt(null); setDemoFormOpen(true)
    }
  }

  /** What the sheet's footer button does once the leader has read it. */
  async function commitParcaSheet() {
    const pending = parcaSheet
    if (!pending) return
    setParcaSheet(null)
    setDemoFormOpen(false)
    setOzalitFormOpen(false)
    setBaskiOnayFormOpen(false)
    if (pending.action === 'review') {
      // Designer has read what they are about to send back round; now they
      // choose the road.
      setReviewedParca(pending.parcalar[0] ?? null)
    } else if (pending.wholeRound) {
      // A round of one: the round's own dialog, as the header opened it — the
      // reason, designer/matbaa choice and revize picker on a reject; the
      // "tasarım tamamlanmadı" hold copy and the sheet signature on an approve.
      setDialog(pending.action)
    } else if (pending.action === 'approve') {
      await d.handleApproveParcalar(pending.parcalar)
      refetchParcaRows()
    } else {
      // Reject still needs a reason and a responsible party, which the sheet
      // cannot express — so the sheet hands off to the dialog that can.
      setParcaReject(pending.parcalar)
    }
  }

  /**
   * A round whose sheet carries ONE parça.
   *
   * Decided in the panel like every other round with a parça list, but the
   * decisions are the round's, and the server treats them that way. Approving
   * the one parça signs the same ledger and moves the stage exactly as the
   * whole-round approve does. Rejecting it per parça does not: that parks the
   * project at the gate and routes the parça through `parca_state`, machinery
   * only a split round has — the matbaa's parça queue skips a one-parça sheet
   * (deriveTeslimParcalar), so the parça would sit on a desk no queue shows.
   * So the row opens the dialogs the header's pair did, sheet first.
   */
  const singleParcaRound = parcaSnapshot.length === 1

  /** The panel's thumbs-up. */
  function approveFromPanel(parcalar) {
    if (!singleParcaRound) { openParcaSheet('approve', parcalar); return }
    setParcaSheet(null)
    // The ozalit and baskı approve dialogs ARE the sheet, with the round's own
    // Onaylayın in the footer — and its required-field guard, its maker-checker
    // and the ONAYLAYAN KİŞİ it writes onto the record come with it.
    if (ledgerKind === 'ozalit') {
      d.setOzalitFormMode('approve'); setOzalitFormOpen(true)
    } else if (ledgerKind === 'baski_onay' || ledgerKind === 'cin_baski_onay') {
      d.setBaskiOnayFormMode('approve'); setBaskiOnayFormOpen(true)
    } else {
      // The demo's approve dialog is a confirm, so the sheet goes in front of it.
      openParcaSheet('approve', parcalar, { wholeRound: true })
    }
  }

  /** The panel's thumbs-down: the sheet, then the reason dialog. */
  function rejectFromPanel(parcalar) {
    openParcaSheet('reject', parcalar, { wholeRound: singleParcaRound })
  }

  const PARCA_SHEET_VERB = { approve: 'Onaylayın', reject: 'Reddedin', review: 'Gönderin' }
  const parcaSheetLabel = parcaSheet
    ? `${parcaSheet.parcalar.join(', ')} · ${PARCA_SHEET_VERB[parcaSheet.action]}`
    : null

  // Per-parça routing rows (migration 074) — who is holding what on this
  // project right now. Distinct from the ledgers the grid above reads: those
  // record who SIGNED what, this records whose turn it is.
  const { parcaRows, refetchParcaRows } = d
  const [parcaRoundBusy, setParcaRoundBusy] = useState(null)
  // Which parça the edit-and-notify sheet was opened for, if any — see
  // openParcaFixSheet. Cleared when either sheet closes.
  const [editParcaScope, setEditParcaScope] = useState(null)

  // Which parçalar the sheet opens on, and whether it opens narrowed to them.
  // The three scopes are mutually exclusive — each caller clears the others,
  // and the dialog's onOpenChange clears all three. See resolveSheetScope for
  // why an add narrows on a different rule than a decision does.
  const { scope: sheetParcaScope, scopeOnly: sheetScopeOnly } = resolveSheetScope({
    decision: parcaSheet?.parcalar,
    add: d.parcaAddScope,
    edit: editParcaScope,
  })
  /* Only the assigned designer declares their own revize finished.
   *
   * This used to include the leader, on the reasoning that they may act on the
   * designer's behalf the way `canRequestOzalit` lets them at the project level.
   * That analogy does not hold: requesting a round is a scheduling decision, but
   * "Revize Bitti, Gönderin" asserts that work somebody ELSE is doing is done —
   * and it then picks the road (matbaa or ekran) on their behalf. A leader
   * pressing it sends a parça back round on a revize the designer may still be
   * halfway through, and the rejection note ("dfgfgd" in the report) is the
   * designer's brief, not theirs.
   *
   * The server still accepts it from a leader — "Bu parçayı yalnızca atanmış
   * tasarımcı veya ekip lideri gönderebilir" — so the escape hatch for an absent
   * designer survives; it is simply not a button on the leader's screen. */
  const canSendParcaBack = user?.role === 'designer' && isAssigned

  /**
   * "Teslim Alın" on ONE parça (migration 076).
   *
   * The round is still out at the matbaa, so there is no whole-round receipt to
   * give — the project sits at its teslim stage until the last parça lands. This
   * is the per-parça one, and it is what opens Onayla/Reddedin for the parça
   * that has actually arrived.
   */
  async function handleReceiveParca(parca) {
    setParcaRoundBusy(parca)
    try {
      await api.receiveParca(project.id, parca)
      toast.success(`${parca} teslim alındı.`)
      refetchParcaRows()
      refetch()
    } catch (err) {
      toast.error(err.message || 'Teslim alma tamamlanamadı.')
    } finally {
      setParcaRoundBusy(null)
    }
  }

  /**
   * Open the sheet on ONE parça the matbaa holds, ready to send back to them
   * (migration 077).
   *
   * The panel's single edit entry point, for both states where the leader may
   * still rewrite a parça: one the matbaa has not started (a free edit), and
   * one an accepted change request released (a correction they are waiting on).
   * The sheet is identical either way — only the panel's framing differs — so
   * this takes the parça and nothing about why.
   *
   * Kept separate from `parcaSheet` on purpose: that state drives the leader's
   * approve / reject / review decisions, and its footer hands off to whichever
   * of those opened it (`commitParcaSheet`). This one is an ordinary
   * edit-and-notify — the footer's own "Düzeltmeyi Matbaaya Gönderin" does the
   * work — so it only needs to say which parça the sheet should open on.
   *
   * Without it the panel named a parça and then sent the leader to the header's
   * whole-sheet button, which opens all three and says nothing about which one
   * they came for.
   */
  function openParcaFixSheet(parca, gate) {
    setParcaSheet(null)
    setEditParcaScope([parca])
    if (gate === 'ozalit') {
      d.setOzalitFormMode('view'); d.setOzalitFormAttempt(null)
      d.setOzalitFormNotify(true); setOzalitFormOpen(true)
    } else {
      d.setDemoFormMode('view'); d.setDemoFormAttempt(null)
      d.setDemoFormNotify(true); setDemoFormOpen(true)
    }
  }

  /**
   * Ask the matbaa to release ONE parça they have already started
   * (migration 077).
   *
   * The whole-sheet "Değişiklik İste" in the header cannot reach this: it is
   * gated on `project.demo_started`, which `startParca` deliberately never sets
   * — so on the split rounds where a single parça is on the press, the only ask
   * that exists is this one.
   */
  async function handleRequestParcaChange(parca, note) {
    setParcaRoundBusy(parca)
    try {
      await api.requestParcaChange(project.id, parca, note)
      toast.success(`${parca} için değişiklik istendi, matbaanın yanıtı bekleniyor.`)
      refetchParcaRows()
    } catch (err) {
      toast.error(err.message || 'Talep gönderilemedi.')
    } finally {
      setParcaRoundBusy(null)
    }
  }

  async function handleRequestParcaRound(parca, route) {
    setParcaRoundBusy(parca)
    try {
      await api.requestParcaRound(project.id, parca, route)
      toast.success(route === 'ekran'
        ? `${parca} ekran onayına gönderildi.`
        : `${parca} matbaaya gönderildi.`)
      setReviewedParca(null)
      refetchParcaRows()
      refetch()
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setParcaRoundBusy(null)
    }
  }
  // Role gate mirrors the queue's (Approvals.jsx): demo is leader-or-matbaa,
  // ozalit is leader-or-designer (the server enforces leader-first and the
  // assigned-designer rule on top), baskı is leader-only. Reject stays
  // leader-only, as it is everywhere else.
  // parcaRoundDecidable first: an undelivered proof (or an ozalit parked on
  // the stage for revision) has nothing to sign, and offering Onayla there
  // gets a 400 back from a button that looked live.
  /* The round is still out at the matbaa, and at least one parça has come back
     (migration 076). The grid becomes the leader's surface for those: receive
     what arrived, then sign it off or bounce it, without waiting for parçalar
     that are still in the press. Leader-only — the server refuses an early
     sign-off from anyone else, since the matbaa is still producing this round. */
  const earlyParcaGate = earlyParcaGateOpen(project, parcaRows)
  /* …and every surface below reads THIS round's rows, not every row the project
     has ever had. One row per parça carries the gate it last cycled on, so the
     finished demo round's rows are still there when the ozalit round starts —
     delivered, received, and therefore "decidable" to anything that does not
     ask which gate they belong to. See roundParcaRows. */
  const roundRows = roundParcaRows(project, parcaRows)

  /**
   * Is there a sheet at the matbaa the leader might still want to change?
   *
   * Stage-gated, because the panel's premise — "the matbaa is holding this
   * round" — is only true at a *_teslim stage. At an *_onay gate the round is
   * back and the approval grid is the surface; a snapshot-derived list there
   * would invent "Matbaada, henüz başlanmadı" rows for parçalar already
   * delivered. An ozalit nobody has requested is the same non-round, which is
   * what `isOzalitRoundLive` answers.
   *
   * Not for the printer: ParcaJobBoard above is their view of these same
   * parçalar, with the buttons that are actually theirs.
   */
  const showChangeRequestPanel = user?.role !== 'printer'
    && EARLY_PARCA_STAGES.has(project?.stage)
    && (project?.stage !== 'ozalit_teslim' || isOzalitRoundLive(project))
  /* The round is at its gate but nobody has confirmed the proof arrived.
   *
   * The panel used to sit out this state entirely (`parcaRoundDecidable` is
   * false until the receipt), which left the header as the only thing on screen
   * — and it says nothing about what is IN the round. Now the panel draws its
   * rows and carries the receipt itself, so the leader sees what they are taking
   * delivery of before they say they have. Nothing is decidable yet: the rows
   * render read-only and the bulk pair below is the receipt, not a sign-off. */
  const roundAwaitsReceipt = ledgerKind === 'ozalit'
    ? awaitsOzalitReceipt(project)
    : ((project?.stage === 'demo_onay' || project?.stage === 'cin_demo_onay')
      && project?.demo_received !== true)
  const showParcaGrid = parcaSnapshot.length > 0 && (
    earlyParcaGate
      // Leader-only was too narrow, and it contradicted the round-level rule
      // one branch down. `receiveParca` accepts "ekip lideri veya atanmış
      // tasarımcı" — the same pair as the whole-round receipt — so an assigned
      // designer could take delivery of the WHOLE ozalit but not of the parça
      // that came back first. They get the rows and the per-parça receipt here;
      // the sign-off stays the leader's (canDecideParca, below).
      ? isLeader || (user?.role === 'designer' && isAssigned)
      : (parcaRoundDecidable(project) || roundAwaitsReceipt)
        && parcaPanelViewer(user, ledgerKind, { isAssigned })
  )
  /* …and whether this viewer may act on what they see. Seeing and deciding come
     apart wherever the server's two answers differ: an assigned designer takes
     delivery — of the round at the demo gate, of a single parça at the early
     gate — and signs nothing in either place. */
  const canDecideParca = parcaPanelDecider(user, ledgerKind, { project })

  // ---------------------------------------------------------------------------
  // Loading / empty states
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="rounded-xl border border-dashed bg-card p-12 text-center">
        <p className="text-sm font-medium text-foreground">Proje bulunamadı.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => window.history.back()}>
          Geri dön
        </Button>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <div className="space-y-6">
        {/* Header section: back button, deleted banner, header card */}
        <ProjectDetailHeader d={d} />

        {/* The matbaa's parçalar on this project (migration 074).
            Directly under the header because it replaces what used to be in
            it: on a split round the header's whole-sheet "İşlemi Başlatın" is
            hidden, and these are the buttons that stamp the right scope. Same
            board Matbaa İşleri and the Onaylar queue render, so a printer who
            arrived here from a "Detay" link acts without bouncing back. */}
        {d.printerSplitRound && (
          <section className="space-y-2.5">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Parça bazlı işleriniz
            </h2>
            <ParcaJobBoard
              rows={d.printerParcaJobs}
              // Delivering the LAST parça advances the project too
              // (allParcalarDelivered → advanceProject), so the project row is
              // stale as well, not just the parça lists.
              onChanged={() => { d.refetchParcaJobs(); refetchParcaRows(); d.refetch() }}
              compact
            />
          </section>
        )}

        {/* Per-parça onay/red — sits directly under the header's action row,
            the same place the queue puts it relative to its own row. */}
        {showParcaGrid && (
          <div className="rounded-xl border bg-card p-4">
            <ParcaApprovalGrid
              project={project}
              kind={ledgerKind}
              // Who is looking. The ozalit ledger is multi-party, so "still
              // pending" is a question about this viewer — see pendingParcalar.
              user={user}
              snapshotParcalar={parcaSnapshot}
              // Parçalar the project has that no round ever carried. Not on the
              // snapshot, so the grid cannot derive them — and the gate will not
              // close while any exist, which makes this the only place the
              // leader can find out why. See ParcaApprovalGrid's prop note.
              neverSentParcalar={d.unsentParcalar}
              busy={d.processingEkranDemo}
              // Both open the sheet first; the decision is taken from its
              // footer. Reject then hands off to the reason/party dialog,
              // which is the part the sheet cannot carry.
              // Only for a viewer who may actually decide. At the demo gate an
              // assigned designer sees this panel so they can take delivery of
              // the round, but the sign-off there is the leader's — offering
              // them a thumbs-up would be a button the server refuses.
              onApproveParcalar={canDecideParca ? approveFromPanel : undefined}
              // Reject is demo/ozalit only. Baskı Onayı is a leader-to-leader
              // maker-checker (migration 070) with no designer or matbaa leg —
              // there is no desk to send a parça back to, and computeRejection
              // refuses a per-parça reject outside the demo/ozalit onay stages
              // ("Parça bazlı red yalnızca demo ve ozalit onay aşamalarında
              // yapılabilir"). Offering the button here is a guaranteed 400.
              //
              // On a round of one the row's thumbs-down is the WHOLE-round
              // reject, so it answers to that gate instead: `availableActions`
              // hands it over as 'reject-parca' only past the receipt, to a
              // leader who has not already signed, and never at baskı.
              onRejectParcalar={
                (singleParcaRound
                  ? d.actions.includes('reject-parca')
                  : canDecideParca && isLeader && ledgerKind !== 'baski_onay' && ledgerKind !== 'cin_baski_onay')
                  ? rejectFromPanel
                  : undefined
              }
              // "Tümünü Reddedin" — the header's old whole-round Reddet, moved
              // in here so both bulk decisions live beside the per-parça ones.
              // Same dialog, same action; `availableActions` still owns every
              // gate and hands it over as 'reject-parca' when this panel is the
              // surface (it emits plain 'reject' for the header otherwise).
              onBulkReject={d.actions.includes('reject-parca')
                ? () => setDialog('reject')
                : undefined}
              // The whole-round receipt, moved in beside the other two. Same
              // confirm dialog the header opened; `receiptInPanel` (the hook) and
              // `showParcaGrid` (above) both key off parcaPanelViewer, so the
              // buttons and the panel can never disagree about who draws them.
              roundAwaitsReceipt={roundAwaitsReceipt}
              // Baskı Onayı's maker half. One button for one document — see the
              // grid's prop note. It opens the same form the header's button
              // used to, in the same mode; only its home moved.
              onPrepareSheet={canDecideParca && (ledgerKind === 'baski_onay' || ledgerKind === 'cin_baski_onay')
                ? () => { setParcaSheet(null); d.setBaskiOnayFormMode('approve'); setBaskiOnayFormOpen(true) }
                : undefined}
              onBulkReceive={d.receiptInPanel && (d.canReceiveDemo || d.canReceiveOzalit)
                ? () => d.setTeslimConfirm(ledgerKind === 'ozalit' ? 'ozalit-received' : 'demo-received')
                : undefined}
              onBulkNotReceived={d.receiptInPanel && (d.canReceiveDemo || d.canReceiveOzalit)
                ? () => d.setTeslimConfirm(ledgerKind === 'ozalit' ? 'ozalit-not-received' : 'demo-not-received')
                : undefined}
              // Only while the round is unfinished: these rows say where each
              // parça physically is, which is the difference between "not
              // approved yet" and "not here yet". At the *_onay gates the whole
              // round has arrived under one project-level receipt, and passing
              // rows would offer "Teslim Alın" on parçalar already received.
              parcaRows={earlyParcaGate ? roundRows : null}
              onReceiveParca={earlyParcaGate ? handleReceiveParca : undefined}
            />
          </div>
        )}

        {/* What the leader can still change on the sheet the matbaa is holding,
            and what they have to ask for. Above the returned-parça panel
            because it is about the round that is still out, while that one is
            about work that has come back. Renders nothing outside a split
            round the matbaa actually holds. */}
        {showChangeRequestPanel && (
          <ParcaChangeRequestPanel
            rows={roundRows}
            // The round's real parça list. Routing rows only exist for
            // parçalar somebody has acted on, so without this the panel shows
            // the one parça the matbaa started and none of the ones the leader
            // can still edit — see the component's own note.
            snapshotParcalar={parcaSnapshot}
            // Which sheet this round's parçalar belong to. The panel synthesises
            // rows for parçalar that have no routing row yet, and those cannot
            // carry a gate of their own — see its `untouched` note.
            // `ledgerKind` is already 'demo' | 'ozalit' at the *_teslim stages,
            // which is exactly the parca_state.gate domain.
            gate={ledgerKind}
            canAct={isLeader}
            busyParca={parcaRoundBusy}
            onRequestChange={handleRequestParcaChange}
            onEditParca={openParcaFixSheet}
          />
        )}

        {/* Whose desk each parça is on, and the designer's way back out. Sits
            under the approval grid because it answers the question the grid
            raises: the grid says KİTAP is not signed off, this says why and
            who has it. */}
        <ParcaReturnedPanel
          rows={roundRows}
          canAct={canSendParcaBack}
          busyParca={parcaRoundBusy}
          reviewedParca={reviewedParca}
          // Sheet first: the designer sees what they are putting back into the
          // pipeline before the two roads are offered.
          onReview={(parca) => openParcaSheet('review', [parca])}
          onRequestRound={handleRequestParcaRound}
        />

        {/* Body grid */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ProjectHistory
            entries={historyWithAttempts}
            projectType={project.type}
            onOpenDemoForm={(attempt, round, snapshotId) => {
              d.setDemoFormAttempt(attempt)
              d.setDemoFormRound(round ?? null)
              d.setDemoFormSnapshot(snapshotId ?? null)
              d.setDemoFormMode('history')
              d.setDemoFormOpen(true)
            }}
            onOpenOzalitForm={(attempt, round, snapshotId) => {
              d.setOzalitFormAttempt(attempt)
              d.setOzalitFormRound(round ?? null)
              d.setOzalitFormSnapshot(snapshotId ?? null)
              d.setOzalitFormMode('history')
              d.setOzalitFormOpen(true)
            }}
          />

          <div className="space-y-4">
            <DesignerPanel project={project} allDesigners={d.allDesigners} />

            <SubtaskCard
              project={project}
              user={user}
              isLeader={d.isLeader}
              isAssigned={isAssigned}
              canEditSubtask={d.canEditSubtask}
              canEditSubtasks={d.canEditSubtasks}
              inRevision={d.inRevision}
              subtasksSafe={d.subtasksSafe}
              progressCountedSubtasks={d.progressCountedSubtasks}
              hasSubtaskChanges={d.hasSubtaskChanges}
              pendingRevize={d.pendingRevize}
              localDone={d.localDone}
              subtaskChecked={d.subtaskChecked}
              toggleSubtask={d.toggleSubtask}
              saving={d.saving}
              toggling={d.toggling}
              onSaveChanges={d.saveSubtaskChanges}
              onAddDesignerBatch={d.handleDesignerBatchAdd}
              onRedoneDesignerBatch={d.handleDesignerBatchRedone}
              onRedo={d.handleRedo}
              onRevize={d.handleRevize}
            />
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Dialogs                                                           */}
      {/* ----------------------------------------------------------------- */}

      <ApprovalDialog
        open={!!dialog}
        onOpenChange={(v) => setDialog(v ? dialog : null)}
        project={project}
        mode={dialog || 'approve'}
        advanceLabel={d.advanceLabel}
        onDone={onActionDone}
      />

      <EkranDemoRejectDialog
        open={ekranDemoRejectOpen}
        onOpenChange={setEkranDemoRejectOpen}
        project={project}
        onDone={onActionDone}
      />

      {/* Per-parça reject (migration 074): the leader names the responsible
          party, and the parça goes to that desk while the project stays put. */}
      <ParcaRejectDialog
        open={!!parcaReject}
        onOpenChange={(v) => !v && setParcaReject(null)}
        project={project}
        parcalar={parcaReject ?? []}
        busy={d.processingEkranDemo}
        onConfirm={async (parcalar, reason, target) => {
          const updated = await d.handleRejectParcalar(parcalar, reason, target)
          // Only close on success — a failed reject leaves the dialog open with
          // the leader's reason still typed, rather than silently discarding it.
          if (updated) setParcaReject(null)
        }}
      />

      <NewProjectDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        project={project}
        onUpdated={(updated) => {
          setProject((prev) => ({ ...prev, ...updated }))
          refetch()
        }}
        onDelete={() => {
          setEditOpen(false)
          setDeleteOpen(true)
        }}
      />

      <OzalitFormDialog
        open={ozalitFormOpen}
        onOpenChange={(v) => { d.setOzalitFormOpen(v); if (!v) { d.setOzalitFormAttempt(null); d.setOzalitFormRound(null); d.setOzalitFormSnapshot(null); d.setOzalitFormNotify(false); d.setOzalitFormStartWork(false); setParcaSheet(null); setEditParcaScope(null); d.setParcaAddScope(null) } }}
        project={project}
        mode={ozalitFormMode}
        viewAttempt={ozalitFormAttempt}
        viewAttemptLabel={ozalitFormRound}
        viewDemoId={ozalitFormSnapshot}
        notifyOnSave={ozalitFormNotify}
        // Matbaa's "İşlemi Başlatın" opened this sheet: the footer stamps
        // ozalit_started once they've read it. Closed only on success, so a
        // failed stamp leaves them on the form with the error toast.
        // Two things can drive this footer slot: the matbaa's start gate, and a
        // leader's per-parça decision (migration 074). The parça action wins —
        // the two never co-occur, since a printer has no parça grid.
        onStartWork={parcaSheet
          ? commitParcaSheet
          : ozalitFormStartWork
            ? async () => {
              if (!await d.handleOzalitStart()) return
              setOzalitFormOpen(false); d.setOzalitFormStartWork(false)
            }
            : undefined}
        // Sheet-first, and the sheet is the parça: a leader deciding KUTU (or a
        // designer sending it back round) opens KUTU's block, not the whole
        // round it was sent on. Same source as the button's own label above.
        parcaScope={sheetParcaScope}
        // A sheet opened for ONE parça opens on that parça — approve, reject
        // and the designer's send-back alike. The leader tapping a single
        // row's thumbs-up is deciding that block, and a document showing all
        // three while the footer says "KUTU · Onaylayın" invites signing off
        // against the wrong one. The bulk shortcut passes every parça it
        // covers, so it still opens as the whole round — which is exactly what
        // someone approving the lot needs to read. Same for the correction a
        // released parça is waiting for. See SpecFormDialog's `showAllParca`;
        // the other view is one tap away in the banner either way.
        parcaScopeOnly={sheetScopeOnly}
        // A sheet opened to DECIDE on is read-only: it is the record being
        // signed, not a draft. See isDecisionReview in
        // lib/spec-form-variants.js. `editParcaScope` is deliberately absent
        // — that path IS the sanctioned correction, and it notifies the matbaa.
        decisionContext={parcaSheet}
        // Which parça blocks the sheet must render read-only on the leader's
        // edit-and-notify path (migration 077).
        parcaRows={roundRows}
        // Set only by "Kalan Parçaları Gönderin": the parçalar this opening
        // will put on the round. Ticks them on the sheet and authorises the
        // addition on save — every other opening leaves it null.
        preselectParcalar={d.parcaAddScope}
        startWorkLabel={parcaSheetLabel}
        startingWork={d.startingWork || d.processingEkranDemo}
        onDone={onActionDone}
      />

      <BaskiOnayFormDialog
        open={baskiOnayFormOpen}
        onOpenChange={(v) => { setBaskiOnayFormOpen(v); if (!v) setParcaSheet(null) }}
        project={project}
        mode={baskiOnayFormMode}
        // A per-parça baskı onayı opens here (see openParcaSheet), on its own
        // sheet, with the same read-only decision footer the demo and ozalit
        // sheets carry. All absent for the prepare / whole-round approve this
        // dialog is also opened for.
        onStartWork={parcaSheet ? commitParcaSheet : undefined}
        parcaScope={sheetParcaScope}
        parcaScopeOnly={sheetScopeOnly}
        decisionContext={parcaSheet}
        startWorkLabel={parcaSheetLabel}
        startingWork={d.processingEkranDemo}
        onDone={onActionDone}
      />

      <DemoFormDialog
        open={demoFormOpen}
        onOpenChange={(v) => { setDemoFormOpen(v); if (!v) { d.setDemoFormAttempt(null); d.setDemoFormRound(null); d.setDemoFormSnapshot(null); d.setDemoFormNotify(false); d.setDemoFormStartWork(false); setParcaSheet(null); setEditParcaScope(null); d.setParcaAddScope(null) } }}
        project={project}
        mode={demoFormMode}
        viewAttempt={demoFormAttempt}
        viewAttemptLabel={demoFormRound}
        viewDemoId={demoFormSnapshot}
        notifyOnSave={demoFormNotify}
        // See the ozalit dialog above — same review-then-start gate.
        onStartWork={parcaSheet
          ? commitParcaSheet
          : demoFormStartWork
            ? async () => {
              if (!await d.handleDemoStart()) return
              setDemoFormOpen(false); d.setDemoFormStartWork(false)
            }
            : undefined}
        parcaScope={sheetParcaScope}
        // A sheet opened for ONE parça opens on that parça — approve, reject
        // and the designer's send-back alike. The leader tapping a single
        // row's thumbs-up is deciding that block, and a document showing all
        // three while the footer says "KUTU · Onaylayın" invites signing off
        // against the wrong one. The bulk shortcut passes every parça it
        // covers, so it still opens as the whole round — which is exactly what
        // someone approving the lot needs to read. Same for the correction a
        // released parça is waiting for. See SpecFormDialog's `showAllParca`;
        // the other view is one tap away in the banner either way.
        parcaScopeOnly={sheetScopeOnly}
        // A sheet opened to DECIDE on is read-only: it is the record being
        // signed, not a draft. See isDecisionReview in
        // lib/spec-form-variants.js. `editParcaScope` is deliberately absent
        // — that path IS the sanctioned correction, and it notifies the matbaa.
        decisionContext={parcaSheet}
        // Which parça blocks the sheet must render read-only on the leader's
        // edit-and-notify path (migration 077).
        parcaRows={roundRows}
        // Set only by "Kalan Parçaları Gönderin": the parçalar this opening
        // will put on the round. Ticks them on the sheet and authorises the
        // addition on save — every other opening leaves it null.
        preselectParcalar={d.parcaAddScope}
        startWorkLabel={parcaSheetLabel}
        startingWork={d.startingWork || d.processingEkranDemo}
        onDone={onActionDone}
      />

      <TalepSignDialog
        order={signOrder}
        open={!!signOrder}
        onOpenChange={(v) => !v && setSignOrder(null)}
        onSigned={handleOrderSigned}
        onUpdated={handleOrderUpdated}
      />

      <OzalitFormDialog
        open={!!ozalitRequestOrder}
        onOpenChange={(v) => !v && setOzalitRequestOrder(null)}
        project={project}
        order={ozalitRequestOrder}
        mode={orderOzalitFormMode(ozalitRequestOrder, user)}
        onDone={handleOrderOzalitRequested}
      />

      <SiparisBaskiOnayFormDialog
        order={siparisBaskiOnayOrder}
        open={!!siparisBaskiOnayOrder}
        onOpenChange={(v) => !v && setSiparisBaskiOnayOrder(null)}
        onApproved={handleSiparisBaskiOnayApproved}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Projeyi sil"
        description={project && (
          <span className="block space-y-2.5">
            <span className="block">"{project.title}" Silinen Projeler'e taşınacak. İstediğiniz zaman geri yükleyebilirsiniz.</span>
            {IN_FLIGHT_DEMO_OZALIT_STAGES.has(project.stage) && (
              <span className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{STAGE_LABELS[project.stage]} bekleniyor, silinirse kuyruktan kaybolur.</span>
              </span>
            )}
          </span>
        )}
        confirmLabel="Sil"
        cancelLabel="Vazgeç"
        variant="destructive"
        busy={deleting}
        busyLabel="Siliniyor…"
        onConfirm={confirmDeleteProject}
      />

      {/* Second step in front of the four teslim decisions. */}
      <ConfirmDialog
        open={!!teslimConfirm}
        onOpenChange={(v) => !v && setTeslimConfirm(null)}
        title={d.teslimConfirmConfig?.title}
        description={d.teslimConfirmConfig?.description}
        confirmLabel={d.teslimConfirmConfig?.confirmLabel}
        cancelLabel="Vazgeç"
        variant={d.teslimConfirmConfig?.variant}
        busy={receiving || reportingNotReceived || cancellingRequest || respondingChange || processingEkranDemo}
        onConfirm={() => d.teslimConfirmConfig?.onConfirm?.()}
      />

      {/* The leader-side change-request dialog used to live here: a single
          note applied to the whole sheet. The whole-sheet ask was unreachable
          on split rounds (it was gated on `project.demo_started`, which
          `startParca` deliberately never sets), so on a multi-parça round the
          free edit stayed open over a parça already on the press and the ask
          was unreachable. The per-parça panel above is now the only surface:
          each row names its parça, the note rides with it, and the button is
          offered only on a parça already on the press. The matbaa's
          accept/decline side is `teslimConfirm`. */}
    </>
  )
}
