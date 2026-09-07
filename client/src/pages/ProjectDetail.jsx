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
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
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
import ParcaRejectDialog from '@/components/ParcaRejectDialog'
import ParcaReturnedPanel from '@/components/ParcaReturnedPanel'
import { isDemoApprover, orderOzalitFormMode } from '@/domain'

import { useProjectDetail } from '@/hooks/useProjectDetail'
import { useParcaSnapshot, parcaRoundDecidable } from '@/hooks/useParcaSnapshot'
import { useProjectParcaState } from '@/hooks/useParcaQueue'
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
    changeRequestOpen, setChangeRequestOpen, changeRequestNote, setChangeRequestNote, requestingChange,
    receiving, reportingNotReceived, cancellingRequest, respondingChange, processingEkranDemo,
    historyWithAttempts,
    handleOrderSigned, handleOrderUpdated, handleOrderOzalitRequested, handleSiparisBaskiOnayApproved,
    handleRequestChange,
    confirmDeleteProject, onActionDone,
  } = d

  // Per-parça approval (migrations 068/069/070) — the same grid the Onaylar
  // queue shows, on the project's own page. It is additive: it renders only
  // on a round whose snapshot lists 2+ parçalar, where the single whole-round
  // Onayla button can't express "KUTU is fine, KİTAP isn't". A single-parça
  // sheet keeps the header's Onayla/Reddet pair and nothing changes.
  //
  // Hook order: this must run before the loading/empty early-returns below,
  // so it is called here and no-ops while `project` is still null.
  const { parcalar: parcaSnapshot, ledgerKind } = useParcaSnapshot(project)
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

  function openParcaSheet(action, parcalar) {
    setParcaSheet({ action, parcalar: parcalar ?? [] })
    // The gate decides which sheet — the same variant the round was authored in.
    if (ledgerKind === 'ozalit') {
      d.setOzalitFormMode('view'); d.setOzalitFormAttempt(null); setOzalitFormOpen(true)
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
    if (pending.action === 'review') {
      // Designer has read what they are about to send back round; now they
      // choose the road.
      setReviewedParca(pending.parcalar[0] ?? null)
    } else if (pending.action === 'approve') {
      await d.handleApproveParcalar(pending.parcalar)
      refetchParcaRows()
    } else {
      // Reject still needs a reason and a responsible party, which the sheet
      // cannot express — so the sheet hands off to the dialog that can.
      setParcaReject(pending.parcalar)
    }
  }

  const PARCA_SHEET_VERB = { approve: 'Onaylayın', reject: 'Reddedin', review: 'Gönderin' }
  const parcaSheetLabel = parcaSheet
    ? `${parcaSheet.parcalar.join(', ')} · ${PARCA_SHEET_VERB[parcaSheet.action]}`
    : null

  // Per-parça routing rows (migration 074) — who is holding what on this
  // project right now. Distinct from the ledgers the grid above reads: those
  // record who SIGNED what, this records whose turn it is.
  const { rows: parcaRows, refetch: refetchParcaRows } = useProjectParcaState(project?.id)
  const [parcaRoundBusy, setParcaRoundBusy] = useState(null)
  // A designer may send back only a parça on a project they are assigned to;
  // a leader may do it on the designer's behalf, matching the latitude
  // canRequestOzalit gives them on the project-level round.
  const canSendParcaBack = isLeader || (user?.role === 'designer' && isAssigned)

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
  const showParcaGrid = parcaSnapshot.length >= 2 && parcaRoundDecidable(project) && (
    ledgerKind === 'demo'
      ? isDemoApprover(user)
      : ledgerKind === 'ozalit'
        ? (isLeader || user?.role === 'designer')
        : isLeader
  )

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

        {/* Per-parça onay/red — sits directly under the header's action row,
            the same place the queue puts it relative to its own row. */}
        {showParcaGrid && (
          <div className="rounded-xl border bg-card p-4">
            <ParcaApprovalGrid
              project={project}
              kind={ledgerKind}
              snapshotParcalar={parcaSnapshot}
              busy={d.processingEkranDemo}
              // Both open the sheet first; the decision is taken from its
              // footer. Reject then hands off to the reason/party dialog,
              // which is the part the sheet cannot carry.
              onApproveParcalar={(parcalar) => openParcaSheet('approve', parcalar)}
              onRejectParcalar={isLeader ? (parcalar) => openParcaSheet('reject', parcalar) : undefined}
            />
          </div>
        )}

        {/* Whose desk each parça is on, and the designer's way back out. Sits
            under the approval grid because it answers the question the grid
            raises: the grid says KİTAP is not signed off, this says why and
            who has it. */}
        <ParcaReturnedPanel
          rows={parcaRows}
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
        onOpenChange={(v) => { d.setOzalitFormOpen(v); if (!v) { d.setOzalitFormAttempt(null); d.setOzalitFormRound(null); d.setOzalitFormSnapshot(null); d.setOzalitFormNotify(false); d.setOzalitFormStartWork(false); setParcaSheet(null) } }}
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
        startWorkLabel={parcaSheetLabel}
        startingWork={d.startingWork || d.processingEkranDemo}
        onDone={onActionDone}
      />

      <BaskiOnayFormDialog
        open={baskiOnayFormOpen}
        onOpenChange={setBaskiOnayFormOpen}
        project={project}
        mode={baskiOnayFormMode}
        onDone={onActionDone}
      />

      <DemoFormDialog
        open={demoFormOpen}
        onOpenChange={(v) => { setDemoFormOpen(v); if (!v) { d.setDemoFormAttempt(null); d.setDemoFormRound(null); d.setDemoFormSnapshot(null); d.setDemoFormNotify(false); d.setDemoFormStartWork(false); setParcaSheet(null) } }}
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

      {/* Change-request note dialog */}
      <Dialog open={!!changeRequestOpen} onOpenChange={(v) => !v && !requestingChange && setChangeRequestOpen(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Değişiklik isteyin</DialogTitle>
            <DialogDescription>
              Matbaa {changeRequestOpen === 'demo' ? 'demo' : 'ozalit'} çalışmasına başladı. Ne değiştirmek
              istediğinizi kısaca yazabilirsiniz — matbaa kabul ederse iptal veya düzenleme yapabilirsiniz.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={changeRequestNote}
            onChange={(e) => setChangeRequestNote(e.target.value)}
            placeholder="Örn: renk yanlış, iptal etmek istiyorum…"
            maxLength={500}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setChangeRequestOpen(null)} disabled={requestingChange}>
              Vazgeç
            </Button>
            <Button
              type="button"
              onClick={() => handleRequestChange(changeRequestOpen)}
              disabled={requestingChange}
              loading={requestingChange}
            >
              {requestingChange ? 'Gönderiliyor…' : 'Talebi Gönderin'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
