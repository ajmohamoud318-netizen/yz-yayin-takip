import { useParams } from 'react-router-dom'
import {
  AlertTriangle,
} from 'lucide-react'

import {
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
import { canMarkDemoStarted, canMarkOzalitStarted, orderOzalitFormMode } from '@/domain'

import { useProjectDetail } from '@/hooks/useProjectDetail'
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
    user, isAssigned,
    setDialog, setProject, refetch,
    dialog, editOpen, setEditOpen, deleteOpen, setDeleteOpen, deleting,
    ozalitFormOpen, setOzalitFormOpen, ozalitFormMode, ozalitFormAttempt, ozalitFormRound, ozalitFormSnapshot, ozalitFormNotify,
    demoFormOpen, setDemoFormOpen, demoFormMode, demoFormAttempt, demoFormRound, demoFormSnapshot, demoFormNotify,
    baskiOnayFormOpen, setBaskiOnayFormOpen, baskiOnayFormMode,
    ekranDemoRejectOpen, setEkranDemoRejectOpen,
    signOrder, setSignOrder, siparisBaskiOnayOrder, setSiparisBaskiOnayOrder,
    ozalitRequestOrder, setOzalitRequestOrder,
    teslimConfirm, setTeslimConfirm,
    changeRequestOpen, setChangeRequestOpen, changeRequestNote, setChangeRequestNote, requestingChange,
    receiving, reportingNotReceived, startingWork, cancellingRequest, respondingChange, processingEkranDemo,
    historyWithAttempts,
    handleOrderSigned, handleOrderUpdated, handleOrderOzalitRequested, handleSiparisBaskiOnayApproved,
    handleDemoStart, handleOzalitStart,
    handleRequestChange,
    confirmDeleteProject, onActionDone,
  } = d

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
              activePage={d.activePage}
              allUsers={d.allUsers}
              saving={d.saving}
              toggling={d.toggling}
              onSaveChanges={d.saveSubtaskChanges}
              onPageClick={d.handlePageClick}
              onPageRework={d.handlePageRework}
              onPageAssign={d.handlePageAssign}
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
        onOpenChange={(v) => { d.setOzalitFormOpen(v); if (!v) { d.setOzalitFormAttempt(null); d.setOzalitFormRound(null); d.setOzalitFormSnapshot(null); d.setOzalitFormNotify(false) } }}
        project={project}
        mode={ozalitFormMode}
        viewAttempt={ozalitFormAttempt}
        viewAttemptLabel={ozalitFormRound}
        viewDemoId={ozalitFormSnapshot}
        notifyOnSave={ozalitFormNotify}
        onDone={onActionDone}
        onStartWork={canMarkOzalitStarted(user, project) ? async () => { await d.handleOzalitStart(); setOzalitFormOpen(false) } : undefined}
        startingWork={startingWork}
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
        onOpenChange={(v) => { setDemoFormOpen(v); if (!v) { d.setDemoFormAttempt(null); d.setDemoFormRound(null); d.setDemoFormSnapshot(null); d.setDemoFormNotify(false) } }}
        project={project}
        mode={demoFormMode}
        viewAttempt={demoFormAttempt}
        viewAttemptLabel={demoFormRound}
        viewDemoId={demoFormSnapshot}
        notifyOnSave={demoFormNotify}
        onStartWork={canMarkDemoStarted(user, project) ? async () => { await handleDemoStart(); setDemoFormOpen(false) } : undefined}
        startingWork={startingWork}
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
        busy={receiving || reportingNotReceived || startingWork || cancellingRequest || respondingChange || processingEkranDemo}
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
