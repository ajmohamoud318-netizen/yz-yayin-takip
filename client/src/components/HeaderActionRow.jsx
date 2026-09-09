import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  PackageX,
  Pencil,
  Printer,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  canMarkDemoStarted, canMarkOzalitStarted,
  canCancelDemoRequest, canCancelOzalitRequest,
  canEditSentDemoRequest, canEditSentOzalitRequest,
  canAddParcalarToRound,
  canRequestDemoChange, canRequestOzalitChange,
  canRespondDemoChange, canRespondOzalitChange,
  canRequestEkranDemo, canRespondEkranDemo,
  lockedParcaNames,
} from '@/domain'

/**
 * The action-buttons row inside the project header card.
 *
 * Single visual row — buttons are mutually exclusive by role/stage/gate but
 * many render at once (e.g. Advance + Form-view + Approve + Reject all live
 * here).  Each button is a self-contained conditional block; no extraction
 * inside this file because there's no repetition, only unique states.
 */
export default function HeaderActionRow({ d }) {
  const {
    project, user, isLeader, isAssigned, isDeleted,
    actions, advanceLabel, approveLabel, sentStatus,
    canReceiveDemo, canReceiveOzalit, isDemoOnayStage, isOzalitOnayStage,
    startingWork, cancellingRequest, receiving, reportingNotReceived,
    respondingChange, processingEkranDemo, pendingRevize,
    setDialog, setTeslimConfirm,
    setDemoFormMode, setDemoFormAttempt, setDemoFormNotify, setDemoFormOpen,
    setDemoFormStartWork, setOzalitFormStartWork,
    setOzalitFormMode, setOzalitFormAttempt, setOzalitFormNotify, setOzalitFormOpen,
    setBaskiOnayFormMode, setBaskiOnayFormOpen,
    setChangeRequestOpen, setEkranDemoRejectOpen,
    handleAdvanceAction, printerSplitRound, parcaRows,
    parcaSnapshot, unsentParcalar: unsent, setParcaAddScope,
  } = d

  if (isDeleted) return null

  // Parçalar of this round the matbaa is producing right now (migration 077).
  // They are why the whole-sheet edit button above may be missing — see
  // canEditSentDemoRequest. Empty everywhere but a split *_teslim round.
  const sheetLockedParcalar = lockedParcaNames(parcaRows)

  /* Which of the two things this slot offers, on a round the matbaa holds.
   *
   * It used to be one button — "Gönderilen Demoyu Düzenleyin" — covering the
   * whole sheet. Editing has since moved into the per-parça panel below, where
   * each row names its own parça, so what is left for the header is the one
   * thing that panel cannot express: parçalar that are not on the round at all.
   *
   * The whole-sheet edit stays for rounds the panel does not render — a single
   * parça, or a legacy round with no snapshot — because there it is the only
   * way in. `parcaSnapshot.length < 2` is the same test the panel uses to
   * decide it has nothing useful to say.
   *
   * With every parça sent and the panel up, this slot goes quiet entirely. */
  const hasUnsent = (unsent ?? []).length > 0
  const panelCoversEditing = (parcaSnapshot ?? []).length >= 2

  function openAddParcalarSheet(gate) {
    setParcaAddScope(unsent)
    if (gate === 'ozalit') {
      setOzalitFormMode('view'); setOzalitFormAttempt(null)
      setOzalitFormNotify(true); setOzalitFormOpen(true)
    } else {
      setDemoFormMode('view'); setDemoFormAttempt(null)
      setDemoFormNotify(true); setDemoFormOpen(true)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Demo formu taslak olarak düzenle — kayıt yalnızca sizin
          tarayıcınızda saklanır, matbaaya gönderilmez. */}
      {(isLeader || (user?.role === 'designer' && isAssigned)) && ['demo_teslim', 'cin_demo_teslim', 'demo_onay', 'cin_demo_onay', 'ozalit_teslim', 'ozalit_onay', 'baskida', 'gumruk', 'satista'].includes(project.stage) && (
        <Button
          size="sm"
          variant="outline"
          title="Yerel taslak — kayıt yalnızca sizin tarayıcınızda saklanır, matbaaya gönderilmez."
          onClick={() => { setDemoFormMode('view'); setDemoFormAttempt(null); setDemoFormNotify(false); setDemoFormOpen(true) }}
        >
          <FileText className="h-4 w-4" />
          Demo Formu (Taslak)
        </Button>
      )}
      {/* Ozalit formu görüntüle */}
      {(isLeader || (user?.role === 'designer' && isAssigned)) && ['ozalit_teslim', 'ozalit_onay', 'baski_onay', 'baskida', 'gumruk', 'satista'].includes(project.stage) && project.type === 'TR' && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => { setOzalitFormMode('view'); setOzalitFormAttempt(null); setOzalitFormNotify(false); setOzalitFormOpen(true) }}
        >
          <FileText className="h-4 w-4" />
          Ozalit Formu
        </Button>
      )}
      {/* Baskı Onay Formu görüntüle */}
      {isLeader && ['baskida', 'gumruk', 'satista'].includes(project.stage) && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => { setBaskiOnayFormMode('view'); setBaskiOnayFormOpen(true) }}
        >
          <FileText className="h-4 w-4" />
          Baskı Onay Formu
        </Button>
      )}
      {actions.includes('advance') && (
        <Button
          size="sm"
          disabled={pendingRevize}
          title={pendingRevize ? 'Önce revize bekleyen alt görevleri revize edin.' : undefined}
          onClick={handleAdvanceAction}
        >
          <Send className="h-4 w-4" />
          {advanceLabel}
        </Button>
      )}
      {/* Matbaa "Başladım" — opens the spec sheet (read-only for the
          printer) and the flag is stamped from its footer, never from a
          bare confirm dialog. Whenever the matbaa is about to do work they
          see the form first: once here, before they commit to producing
          it, and again on Teslim Edin, which is what they hand over. Same
          gate on MatbaaIsleri.jsx and Approvals.jsx.

          Hidden outright once the round is split into parçalar: this button
          stamps the WHOLE sheet as started, which then unlocks a whole-sheet
          Teslim Edin that advances past parçalar nobody produced. The
          ParcaJobBoard below the header is the surface for those — one button
          per parça, each scoped to what it actually stamps. */}
      {canMarkDemoStarted(user, project) && !printerSplitRound && (
        <Button
          size="sm"
          disabled={startingWork}
          onClick={() => {
            setDemoFormMode('view'); setDemoFormAttempt(null); setDemoFormNotify(false)
            setDemoFormStartWork(true); setDemoFormOpen(true)
          }}
        >
          <CheckCircle2 className="h-4 w-4" />
          {startingWork ? 'İşleniyor…' : 'İşlemi Başlatın'}
        </Button>
      )}
      {canMarkOzalitStarted(user, project) && !printerSplitRound && (
        <Button
          size="sm"
          disabled={startingWork}
          onClick={() => {
            setOzalitFormMode('view'); setOzalitFormAttempt(null); setOzalitFormNotify(false)
            setOzalitFormStartWork(true); setOzalitFormOpen(true)
          }}
        >
          <CheckCircle2 className="h-4 w-4" />
          {startingWork ? 'İşleniyor…' : 'İşlemi Başlatın'}
        </Button>
      )}
      {/* Fix owed, printer's turn to wait */}
      {user?.role === 'printer' &&
        (project.stage === 'demo_teslim' || project.stage === 'cin_demo_teslim') &&
        project.demo_fix_pending && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700">
          <Clock className="h-4 w-4" />
          Değişiklik talebini kabul ettiniz, ekip liderinin düzeltmeyi göndermesi bekleniyor
        </span>
      )}
      {user?.role === 'printer' && project.stage === 'ozalit_teslim' && project.ozalit_fix_pending && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700">
          <Clock className="h-4 w-4" />
          Değişiklik talebini kabul ettiniz, ekip liderinin düzeltmeyi göndermesi bekleniyor
        </span>
      )}
      {/* Parçalar this project has that the round never carried. See
          openAddParcalarSheet — this is the header's remaining job on the round,
          and it disappears once nothing is left.

          `canAddParcalarToRound`, NOT the edit gate below it: this one survives
          into demo_onay, where a forgotten parça is usually what the returning
          round makes obvious. The add reopens the round from there; the
          whole-sheet edit underneath cannot, and keeps the stricter gate. */}
      {canAddParcalarToRound(user, project, 'demo') && hasUnsent && (
        <Button
          size="sm"
          onClick={() => openAddParcalarSheet('demo')}
        >
          <Send className="h-4 w-4" />
          Kalan Parçaları Gönderin ({unsent.length})
        </Button>
      )}
      {/* The whole-sheet edit, kept only where the per-parça panel is not
          rendering — otherwise its rows are the better surface, each naming
          the parça it edits. */}
      {canEditSentDemoRequest(user, project) && !hasUnsent && !panelCoversEditing && (
        <Button
          size="sm" variant="outline"
          onClick={() => { setDemoFormMode('view'); setDemoFormAttempt(null); setDemoFormNotify(true); setDemoFormOpen(true) }}
        >
          <Pencil className="h-4 w-4" />
          Gönderilen Demoyu Düzenleyin
        </Button>
      )}
      {/* Which parçalar the sheet edit above will NOT let them touch. The
          button stays — the rest of the round is still theirs to correct — so
          without this the leader opens the form, finds two blocks editable and
          one greyed, and has to guess why. */}
      {isLeader && sheetLockedParcalar.length > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700">
          <Printer className="h-4 w-4" />
          Matbaa {sheetLockedParcalar.join(', ')} baskısına başladı — o parçalar için aşağıdan değişiklik isteyin
        </span>
      )}
      {canCancelDemoRequest(user, project, parcaRows) && (
        <Button
          size="sm" variant="destructive"
          onClick={() => setTeslimConfirm('demo-cancel')}
          disabled={cancellingRequest}
        >
          <Trash2 className="h-4 w-4" />
          {cancellingRequest ? 'İşleniyor…' : 'Demo İsteğini İptal Edin'}
        </Button>
      )}
      {/* Ozalit twin of the pair above — same split, same reasoning. */}
      {canAddParcalarToRound(user, project, 'ozalit') && hasUnsent && (
        <Button
          size="sm"
          onClick={() => openAddParcalarSheet('ozalit')}
        >
          <Send className="h-4 w-4" />
          Kalan Parçaları Gönderin ({unsent.length})
        </Button>
      )}
      {canEditSentOzalitRequest(user, project) && !hasUnsent && !panelCoversEditing && (
        <Button
          size="sm" variant="outline"
          onClick={() => { setOzalitFormMode('view'); setOzalitFormAttempt(null); setOzalitFormNotify(true); setOzalitFormOpen(true) }}
        >
          <Pencil className="h-4 w-4" />
          Gönderilen Ozaliti Düzenleyin
        </Button>
      )}
      {canCancelOzalitRequest(user, project, parcaRows) && (
        <Button
          size="sm" variant="destructive"
          onClick={() => setTeslimConfirm('ozalit-cancel')}
          disabled={cancellingRequest}
        >
          <Trash2 className="h-4 w-4" />
          {cancellingRequest ? 'İşleniyor…' : 'Ozalit İsteğini İptal Edin'}
        </Button>
      )}
      {/* Once started, a cancel/edit is a request the matbaa must
          accept or decline. */}
      {canRequestDemoChange(user, project) && (
        <Button size="sm" variant="outline" className="border-amber-400 bg-amber-300 text-amber-950 hover:bg-amber-400 hover:text-amber-950" onClick={() => setChangeRequestOpen('demo')}>
          <AlertTriangle className="h-4 w-4" />
          Değişiklik İste
        </Button>
      )}
      {canRequestOzalitChange(user, project) && (
        <Button size="sm" variant="outline" className="border-amber-400 bg-amber-300 text-amber-950 hover:bg-amber-400 hover:text-amber-950" onClick={() => setChangeRequestOpen('ozalit')}>
          <AlertTriangle className="h-4 w-4" />
          Değişiklik İste
        </Button>
      )}
      {!canRequestDemoChange(user, project) && project?.demo_change_requested_at &&
        (isLeader || (user?.role === 'designer' && isAssigned)) &&
        ['demo_teslim', 'cin_demo_teslim'].includes(project.stage) && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700">
          <Clock className="h-4 w-4" />
          Değişiklik talebi gönderildi, matbaa yanıtı bekleniyor
        </span>
      )}
      {!canRequestOzalitChange(user, project) && project?.ozalit_change_requested_at &&
        (isLeader || (user?.role === 'designer' && isAssigned)) &&
        project.stage === 'ozalit_teslim' && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700">
          <Clock className="h-4 w-4" />
          Değişiklik talebi gönderildi, matbaa yanıtı bekleniyor
        </span>
      )}
      {/* The matbaa's answer to a pending change-request. */}
      {canRespondDemoChange(user, project) && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {project.demo_change_requested_by_name ?? 'Ekipten biri'}
            {project.demo_change_requested_note ? `: ${project.demo_change_requested_note}` : ' değişiklik istiyor'}
          </span>
          <Button size="sm" variant="success" onClick={() => setTeslimConfirm('demo-change-accept')} disabled={respondingChange}>
            <ThumbsUp className="h-4 w-4" />
            Kabul Et
          </Button>
          <Button size="sm" variant="outline" onClick={() => setTeslimConfirm('demo-change-decline')} disabled={respondingChange}>
            <ThumbsDown className="h-4 w-4" />
            Reddet
          </Button>
        </div>
      )}
      {canRespondOzalitChange(user, project) && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {project.ozalit_change_requested_by_name ?? 'Ekipten biri'}
            {project.ozalit_change_requested_note ? `: ${project.ozalit_change_requested_note}` : ' değişiklik istiyor'}
          </span>
          <Button size="sm" variant="success" onClick={() => setTeslimConfirm('ozalit-change-accept')} disabled={respondingChange}>
            <ThumbsUp className="h-4 w-4" />
            Kabul Et
          </Button>
          <Button size="sm" variant="outline" onClick={() => setTeslimConfirm('ozalit-change-decline')} disabled={respondingChange}>
            <ThumbsDown className="h-4 w-4" />
            Reddet
          </Button>
        </div>
      )}
      {/* Demo "Teslim Alındı" gate — before the Onay. */}
      {canReceiveDemo && (
        <Button size="sm" onClick={() => setTeslimConfirm('demo-received')} disabled={receiving || reportingNotReceived}>
          <CheckCircle2 className="h-4 w-4" />
          {receiving ? 'İşleniyor…' : 'Teslim Alındı'}
        </Button>
      )}
      {/* Escape hatch: the demo was delivered but never actually
          reached anyone — send it back to the matbaa. */}
      {canReceiveDemo && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setTeslimConfirm('demo-not-received')}
          disabled={receiving || reportingNotReceived}
        >
          <PackageX className="h-4 w-4" />
          {reportingNotReceived ? 'İşleniyor…' : 'Teslim Alınamadı'}
        </Button>
      )}
      {/* Ozalit "Teslim Alındı" gate */}
      {canReceiveOzalit && (
        <Button size="sm" onClick={() => setTeslimConfirm('ozalit-received')} disabled={receiving || reportingNotReceived}>
          <CheckCircle2 className="h-4 w-4" />
          {receiving ? 'İşleniyor…' : 'Teslim Alındı'}
        </Button>
      )}
      {canReceiveOzalit && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setTeslimConfirm('ozalit-not-received')}
          disabled={receiving || reportingNotReceived}
        >
          <PackageX className="h-4 w-4" />
          {reportingNotReceived ? 'İşleniyor…' : 'Teslim Alınamadı'}
        </Button>
      )}
      {isOzalitOnayStage && project.ozalit_received && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {project.ozalit_received_by ? `${project.ozalit_received_by} ozaliti teslim aldı` : 'Ozalit teslim alındı'}
        </span>
      )}
      {isDemoOnayStage && project.demo_received && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {project.demo_received_by ? `${project.demo_received_by} demoyu teslim aldı` : 'Demo teslim alındı'}
        </span>
      )}
      {actions.includes('approve') && (
        <Button
          size="sm"
          variant="success"
          onClick={() => {
            if (project.stage === 'ozalit_onay') {
              setOzalitFormMode('approve')
              setOzalitFormOpen(true)
            } else if (project.stage === 'baski_onay' || project.stage === 'cin_baski_onay') {
              setBaskiOnayFormMode('approve')
              setBaskiOnayFormOpen(true)
            } else {
              setDialog('approve')
            }
          }}
        >
          <ThumbsUp className="h-4 w-4" />
          {approveLabel}
        </Button>
      )}
      {/* Demo-held hint */}
      {(project.stage === 'demo_onay' || project.stage === 'cin_demo_onay') &&
        project.demo_held === true &&
        (project.progress ?? 0) < 100 && (
          <span
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800"
            title="Tasarımcı kalan görevleri bitirip yeni demo gönderdiğinde ilerleyecek"
          >
            <Clock className="h-3.5 w-3.5" />
            Tasarım tamamlanmadı, tasarımcı yeni demo gönderdiğinde ilerleyecek
          </span>
        )}
      {/* Ekran Demo Onayı */}
      {canRequestEkranDemo(user, project) && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setTeslimConfirm('ekran-demo-request')}
          disabled={processingEkranDemo}
        >
          <Send className="h-4 w-4" />
          Ekran Demo Onayı İsteyin
        </Button>
      )}
      {project.ekran_demo_requested_at != null && !canRespondEkranDemo(user, project) && (
        <span
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800"
          title="Ekip lideri ekrandan onayladığında proje ilerleyecek"
        >
          <Clock className="h-3.5 w-3.5" />
          Ekran demo onayı istendi, ekip lideri onayı bekleniyor
        </span>
      )}
      {canRespondEkranDemo(user, project) && (
        <>
          <Button
            size="sm"
            variant="success"
            onClick={() => setTeslimConfirm('ekran-demo-approve')}
            disabled={processingEkranDemo}
          >
            <ThumbsUp className="h-4 w-4" />
            Ekran Demoyu Onaylayın
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setEkranDemoRejectOpen(true)}
            disabled={processingEkranDemo}
          >
            <ThumbsDown className="h-4 w-4" />
            Reddet
          </Button>
        </>
      )}
      {actions.includes('reject') && (
        <Button size="sm" variant="destructive" onClick={() => setDialog('reject')}>
          <ThumbsDown className="h-4 w-4" />
          Reddet
        </Button>
      )}
      {sentStatus && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
          <Send className="h-4 w-4" />
          {sentStatus}
        </span>
      )}
    </div>
  )
}
