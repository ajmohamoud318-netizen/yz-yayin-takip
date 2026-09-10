import { useState } from 'react'
import { toast } from 'sonner'

import api from '@/api'
import { stampSpecSignature } from '@/components/SpecFormDialog'

/**
 * Owns every delivery/teslim mutation for the project detail page:
 * receive, not-received, start-work, cancel, ekran-demo, change-request
 * accept/decline.  Also owns the related loading flags and the
 * `teslimConfirm` confirmation-dialog state plus its config map.
 */
export function useProjectDelivery(project, refetch, user) {
  // ---------------------------------------------------------------------------
  // Loading flags
  // ---------------------------------------------------------------------------

  const [receiving, setReceiving] = useState(false)
  const [reportingNotReceived, setReportingNotReceived] = useState(false)
  // Matbaa "Başladım" gate + cancel + change-request (migration 048).
  const [startingWork, setStartingWork] = useState(false)
  const [cancellingRequest, setCancellingRequest] = useState(false)
  // 'demo' | 'ozalit' | null — which change-request note dialog is open.
  const [changeRequestOpen, setChangeRequestOpen] = useState(null)
  const [changeRequestNote, setChangeRequestNote] = useState('')
  const [requestingChange, setRequestingChange] = useState(false)
  const [respondingChange, setRespondingChange] = useState(false)
  // Ekran Demo Onayı — lightweight digital alternative to a physical
  // re-demo for a held demo at 100% progress (migration 050). Covers both
  // the request and the approve step (TESLIM_CONFIRMS entries below) — only
  // one is ever in flight at a time.
  const [processingEkranDemo, setProcessingEkranDemo] = useState(false)

  // Which teslim decision is awaiting an "emin misiniz?" — all four are
  // single-click, irreversible-ish, and sit right next to each other in the
  // action row, so none of them fires straight from the button.
  // 'demo-received' | 'demo-not-received' | 'ozalit-received' | 'ozalit-not-received'
  const [teslimConfirm, setTeslimConfirm] = useState(null)

  // ---------------------------------------------------------------------------
  // Delivery handlers
  // ---------------------------------------------------------------------------

  async function handleReceiveDemo() {
    if (!project) return
    setReceiving(true)
    try {
      await api.receiveDemo(project.id)
      stampSpecSignature('demo', project, { teslimAlanKisi: user?.name ?? '' }).catch(() => {})
      await refetch()
      toast.success('Demo teslim alındı.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setReceiving(false)
      setTeslimConfirm(null)
    }
  }

  async function handleReceiveOzalit() {
    if (!project) return
    setReceiving(true)
    try {
      await api.receiveOzalit(project.id)
      stampSpecSignature('ozalit', project, { teslimAlanKisi: user?.name ?? '' }).catch(() => {})
      await refetch()
      toast.success('Ozalit teslim alındı.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setReceiving(false)
      setTeslimConfirm(null)
    }
  }

  async function handleDemoNotReceived() {
    if (!project) return
    setReportingNotReceived(true)
    try {
      await api.reportDemoNotReceived(project.id)
      await refetch()
      toast.success('Demo teslim alınamadı olarak işaretlendi, matbaaya geri gönderildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setReportingNotReceived(false)
      setTeslimConfirm(null)
    }
  }

  async function handleOzalitNotReceived() {
    if (!project) return
    setReportingNotReceived(true)
    try {
      await api.reportOzalitNotReceived(project.id)
      await refetch()
      toast.success('Ozalit teslim alınamadı olarak işaretlendi, matbaaya geri gönderildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setReportingNotReceived(false)
      setTeslimConfirm(null)
    }
  }

  // Both start handlers are called from inside the spec form (the printer
  // presses İşlemi Başlatın in its footer, after reading the sheet), so they
  // report whether the stamp landed — the caller closes the form only on
  // success and leaves it open, with the error toast, otherwise.
  async function handleDemoStart() {
    if (!project) return false
    setStartingWork(true)
    try {
      await api.markDemoStarted(project.id)
      await refetch()
      toast.success('Demo çalışmasına başladığınız işaretlendi.')
      return true
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
      return false
    } finally {
      setStartingWork(false)
    }
  }

  async function handleOzalitStart() {
    if (!project) return false
    setStartingWork(true)
    try {
      await api.markOzalitStarted(project.id)
      await refetch()
      toast.success('Ozalit çalışmasına başladığınız işaretlendi.')
      return true
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
      return false
    } finally {
      setStartingWork(false)
    }
  }

  async function handleEkranDemoRequest() {
    if (!project) return
    setProcessingEkranDemo(true)
    try {
      await api.requestEkranDemoOnay(project.id)
      await refetch()
      toast.success('Ekran demo onayı istendi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setProcessingEkranDemo(false)
      setTeslimConfirm(null)
    }
  }

  // Approving is no longer a ConfirmDialog verb (see the 'ekran-demo-approve'
  // note by TESLIM_CONFIRMS below) — ApprovalDialog now owns that request via
  // api.approveEkranDemo, with its own busy state.

  // ---------------------------------------------------------------------------
  // Per-parça approval handlers (migrations 068/069/070)
  //
  // The same per-parça FSM gates demo_onay, ozalit_onay, baski_onay and the
  // screen-side equivalents. The route accepts an optional `parcalar` body
  // field; null/omitted defaults to "all still-pending parçalar on the
  // current round" (drives the bulk shortcut). The project's stage picks the
  // matching gate; the snapshot's `_selectedComponents` arrives server-side
  // via the prepare hook, so we only need to forward the leader's selection.
  //
  // Returns the updated project (or null on failure) so the caller can
  // branch on the new stage without a second refetch.
  // ---------------------------------------------------------------------------

  async function handleApproveParcalar(parcalar) {
    if (!project) return null
    setProcessingEkranDemo(true)
    try {
      const updated = await api.approveProject(project.id, parcalar)
      await refetch()
      const remaining = (updated?.stage === project.stage)
        ? 'Onayınız kaydedildi, diğer onaylar bekleniyor.'
        : 'Proje bir sonraki aşamaya geçti.'
      toast.success(remaining)
      return updated
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
      return null
    } finally {
      setProcessingEkranDemo(false)
    }
  }

  async function handleRejectParcalar(parcalar, reason, target) {
    if (!project) return null
    setProcessingEkranDemo(true)
    try {
      // parcalar is an array of parça names; null/omitted = whole-round reject.
      const updated = await api.rejectProject(
        project.id,
        reason,
        [], // revizeIds — designer-led sub-flagging, separate from per-parça reject
        target ?? 'designer',
        parcalar,
      )
      await refetch()
      toast.success('Red kaydedildi.')
      return updated
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
      return null
    } finally {
      setProcessingEkranDemo(false)
    }
  }

  async function handleEkranApproveParcalar(parcalar) {
    if (!project) return null
    setProcessingEkranDemo(true)
    try {
      const updated = await api.approveEkranDemo(project.id, parcalar)
      await refetch()
      const remaining = (updated?.stage === project.stage)
        ? 'Onayınız kaydedildi, bekleyen parçalar var.'
        : 'Ekran demo onaylandı, proje ilerledi.'
      toast.success(remaining)
      return updated
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
      return null
    } finally {
      setProcessingEkranDemo(false)
    }
  }

  async function handlePrepareBaskiParcalar(parcalar) {
    if (!project) return null
    setProcessingEkranDemo(true)
    try {
      const updated = await api.prepareBaskiOnay(project.id, parcalar)
      await refetch()
      toast.success('Baskı onay formu hazırlandı.')
      return updated
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
      return null
    } finally {
      setProcessingEkranDemo(false)
    }
  }

  async function handleDemoCancel() {
    if (!project) return
    setCancellingRequest(true)
    try {
      await api.cancelDemoRequest(project.id)
      await refetch()
      toast.success('Demo talebi iptal edildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setCancellingRequest(false)
      setTeslimConfirm(null)
    }
  }

  async function handleOzalitCancel() {
    if (!project) return
    setCancellingRequest(true)
    try {
      await api.cancelOzalitRequest(project.id)
      await refetch()
      toast.success('Ozalit talebi iptal edildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setCancellingRequest(false)
      setTeslimConfirm(null)
    }
  }

  async function handleRequestChange(kind) {
    if (!project) return
    setRequestingChange(true)
    try {
      if (kind === 'demo') await api.requestDemoChange(project.id, changeRequestNote.trim() || undefined)
      else await api.requestOzalitChange(project.id, changeRequestNote.trim() || undefined)
      await refetch()
      toast.success('Değişiklik talebiniz matbaaya iletildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setRequestingChange(false)
      setChangeRequestOpen(null)
      setChangeRequestNote('')
    }
  }

  async function handleDemoChangeAccept() {
    if (!project) return
    setRespondingChange(true)
    try {
      await api.acceptDemoChangeRequest(project.id)
      await refetch()
      toast.success('Değişiklik talebi kabul edildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setRespondingChange(false)
      setTeslimConfirm(null)
    }
  }

  async function handleDemoChangeDecline() {
    if (!project) return
    setRespondingChange(true)
    try {
      await api.declineDemoChangeRequest(project.id)
      await refetch()
      toast.success('Değişiklik talebi reddedildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setRespondingChange(false)
      setTeslimConfirm(null)
    }
  }

  async function handleOzalitChangeAccept() {
    if (!project) return
    setRespondingChange(true)
    try {
      await api.acceptOzalitChangeRequest(project.id)
      await refetch()
      toast.success('Değişiklik talebi kabul edildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setRespondingChange(false)
      setTeslimConfirm(null)
    }
  }

  async function handleOzalitChangeDecline() {
    if (!project) return
    setRespondingChange(true)
    try {
      await api.declineOzalitChangeRequest(project.id)
      await refetch()
      toast.success('Değişiklik talebi reddedildi.')
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setRespondingChange(false)
      setTeslimConfirm(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Teslim confirm config — maps the teslimConfirm key to dialog copy + handler
  // ---------------------------------------------------------------------------

  // Copy + handler for each teslim decision, keyed by the pending confirm.
  // Both "Teslim Alınamadı" variants send the project back to the matbaa and
  // bump the attempt counter, so the description says so plainly. Neither
  // re-opens the "Başladım" gate — the matbaa owes a re-delivery, not a
  // restart — so the copy promises a re-delivery, not a new round of work.
  const TESLIM_CONFIRMS = {
    'demo-received': {
      title: 'Demoyu teslim aldınız mı?',
      description:
        'Demo "Teslim Alındı" olarak işaretlenecek ve onay adımı açılacak. Bu işlem geri alınamaz.',
      confirmLabel: 'Teslim Aldım',
      variant: 'success',
      onConfirm: handleReceiveDemo,
    },
    'demo-not-received': {
      title: 'Demo size ulaşmadı mı?',
      // At demo_onay the matbaa re-delivers; at cin_demo_onay the round goes
      // back to cin_demo_teslim for the next leg. Either way, demo_attempt
      // ticks up and the round restarts — describe the mechanism, not the
      // (stage-dependent) actor, so the copy reads correctly on both ÇİN and TR.
      description:
        'Proje demo teslim aşamasına geri döner ve yeni bir tur başlatılır (Demo sayacı +1). Bu işlem geri alınamaz.',
      confirmLabel: 'Teslim Alınamadı',
      variant: 'destructive',
      onConfirm: handleDemoNotReceived,
    },
    'ozalit-received': {
      title: 'Ozaliti teslim aldınız mı?',
      description:
        'Ozalit "Teslim Alındı" olarak işaretlenecek ve onay adımı açılacak. Bu işlem geri alınamaz.',
      confirmLabel: 'Teslim Aldım',
      variant: 'success',
      onConfirm: handleReceiveOzalit,
    },
    'ozalit-not-received': {
      title: 'Ozalit size ulaşmadı mı?',
      description:
        'Proje ozalit teslim aşamasına geri döner, matbaa yeniden teslim eder ve verilmiş onaylar sıfırlanır (Ozalit sayacı +1). Bu işlem geri alınamaz.',
      confirmLabel: 'Teslim Alınamadı',
      variant: 'destructive',
      onConfirm: handleOzalitNotReceived,
    },
    'demo-cancel': {
      title: 'Demo talebini iptal edin mi?',
      description:
        'Proje doğrudan tasarıma geri döner. Demo sayacı artmaz — hiçbir şey teslim edilmediği için sayılmaz. Bu işlem geri alınamaz.',
      confirmLabel: 'İptal Edin',
      variant: 'destructive',
      onConfirm: handleDemoCancel,
    },
    'ozalit-cancel': {
      title: 'Ozalit talebini iptal edin mi?',
      description:
        'Proje doğrudan tasarıma geri döner. Ozalit sayacı artmaz — hiçbir şey teslim edilmediği için sayılmaz. Bu işlem geri alınamaz.',
      confirmLabel: 'İptal Edin',
      variant: 'destructive',
      onConfirm: handleOzalitCancel,
    },
    // No 'demo-start' / 'ozalit-start' entry on purpose: the matbaa never
    // starts work from a bare "emin misiniz?". İşlemi Başlatın opens the
    // spec form (HeaderActionRow.jsx) and the flag is stamped from its
    // footer, so the printer always sees what they are producing before
    // they commit to it — and the same sheet again on Teslim Edin, which is
    // what they hand over. MatbaaIsleri.jsx and Approvals.jsx do the same.
    'demo-change-accept': {
      title: 'Değişiklik talebini kabul edin mi?',
      description: 'Ekip lideri veya tasarımcı artık demoyu iptal edebilir ya da düzenleyebilir.',
      confirmLabel: 'Kabul Edin',
      variant: 'success',
      onConfirm: handleDemoChangeAccept,
    },
    'demo-change-decline': {
      title: 'Değişiklik talebini reddedin mi?',
      description: 'Süreç normal teslim akışıyla devam eder, talep eden kişi bilgilendirilir.',
      confirmLabel: 'Reddedin',
      variant: 'destructive',
      onConfirm: handleDemoChangeDecline,
    },
    'ozalit-change-accept': {
      title: 'Değişiklik talebini kabul edin mi?',
      description: 'Ekip lideri veya tasarımcı artık ozaliti iptal edebilir ya da düzenleyebilir.',
      confirmLabel: 'Kabul Edin',
      variant: 'success',
      onConfirm: handleOzalitChangeAccept,
    },
    'ozalit-change-decline': {
      title: 'Değişiklik talebini reddedin mi?',
      description: 'Süreç normal teslim akışıyla devam eder, talep eden kişi bilgilendirilir.',
      confirmLabel: 'Reddedin',
      variant: 'destructive',
      onConfirm: handleOzalitChangeDecline,
    },
    'ekran-demo-request': {
      title: 'Ekran demo onayı istensin mi?',
      description:
        'Matbaaya fiziksel demo göndermeden, ekip liderinin ekrandan tek tıkla onaylamasını isteyeceksiniz.',
      confirmLabel: 'İsteyin',
      variant: 'default',
      onConfirm: handleEkranDemoRequest,
    },
    // No 'ekran-demo-approve' entry — see matbaa-sees-form-first. The leader's
    // approve is a real sign-off, not a "bu işlem geri alınamaz" confirm, so
    // it now opens ApprovalDialog (mode='ekran-demo-approve') instead, which
    // stamps the signature the way every other approve does. HeaderActionRow
    // calls `setDialog('ekran-demo-approve')`, not `setTeslimConfirm`.
  }
  const teslimConfirmConfig = teslimConfirm ? TESLIM_CONFIRMS[teslimConfirm] : null

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    // State
    receiving, reportingNotReceived, startingWork, cancellingRequest,
    respondingChange, requestingChange, processingEkranDemo,
    changeRequestOpen, setChangeRequestOpen, changeRequestNote, setChangeRequestNote,
    teslimConfirm, setTeslimConfirm, teslimConfirmConfig,

    // Handlers
    handleReceiveDemo, handleReceiveOzalit,
    handleDemoNotReceived, handleOzalitNotReceived,
    handleDemoStart, handleOzalitStart,
    handleEkranDemoRequest,
    handleDemoCancel, handleOzalitCancel,
    handleRequestChange,
    handleDemoChangeAccept, handleDemoChangeDecline,
    handleOzalitChangeAccept, handleOzalitChangeDecline,
    // Per-parça approval handlers (migrations 068/069/070): the per-parça
    // grid + bulk button use these. `parcalar` is `string[]` (or null for
    // "all still-pending parçalar").
    handleApproveParcalar, handleRejectParcalar,
    handleEkranApproveParcalar, handlePrepareBaskiParcalar,
  }
}
