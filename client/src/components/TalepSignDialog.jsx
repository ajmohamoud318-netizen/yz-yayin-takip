import { useState, useEffect, useRef } from 'react'
import { Check, X } from 'lucide-react'
import { toast } from 'sonner'

import api, {
  ORDER_STEP_LABELS, ORDER_STEP_NEXT, ORDER_REJECT_TO, ORDER_REJECT_TARGETS,
  canApproveMatbaaOnayNow, matbaaOnayLeaderApproved,
} from '@/api'
import { getComponentsForProject, saveComponentsForProject, primeProductInfoCache } from '@/data/productCatalog'
import { saveSubtaskFlags } from '@/data/orderSubtasks'
import { useAuth } from '@/hooks/useAuth'
import { useOrderOzalitRound } from '@/hooks/useOrderOzalitRound'
import { isSubtaskDone } from '@/domain/services/progress'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DIALOG_MOBILE_SHEET,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import MiniPipeline from '@/components/TalepMiniPipeline'
import TalepRejectForm from '@/components/TalepRejectForm'
import { TalepAssignDesigners, TalepOrderSummary } from '@/components/TalepOrderSummary'
import { TalepMatbaaReceiptBanner, TalepOzalitPanel } from '@/components/TalepOzalitPanel'
import { ProductInfoPanel, SubtaskPanel } from '@/components/TalepSpecEditors'

/* ------------------------------------------------------------------ */
/*  Sibling files (slice: client god-components)                      */
/* ------------------------------------------------------------------ */
/**
 * This file used to be 1433 lines. What it kept is the sign-off itself —
 * which step this is, who may act on it, and what the two submits (advance,
 * reject) write. Everything the dialog SHOWS or does around that moved next
 * to it:
 *
 *  - `TalepOrderSummary.jsx`  — what was ordered + the assign-step picker
 *  - `TalepMiniPipeline.jsx`  — the step strip
 *  - `TalepSpecEditors.jsx`   — alt görevler / Ürün Bilgileri editors + panels
 *  - `TalepRejectForm.jsx`    — route, revize picker, reason
 *  - `TalepOzalitPanel.jsx`   — the matbaa_ozalit_yapiyor round + receipt banner
 *  - `hooks/useOrderOzalitRound.js` — every action on that round
 *  - `data/orderSubtasks.js`  — persisting the designer's Revize flags
 */

const deepClone = (x) => JSON.parse(JSON.stringify(x ?? []))
// Reads the shared, server-backed spec (cache → local mirror → seed).
function loadProductComps(projectId) {
  return getComponentsForProject(projectId)
}
// Designer edits during their step persist to the same server-side catalog
// Ürün Bilgileri and the Demo/Ozalit forms read from.
function saveProductComps(projectId, comps) {
  return saveComponentsForProject(projectId, comps)
}

/**
 * Shared sign-off dialog for every step of the sipariş talep mini-workflow.
 *
 * Props:
 *   order       – the full order object (with order_history)
 *   open        – boolean
 *   onOpenChange – (bool) => void
 *   onSigned    – (updatedOrder) => void  — called after successful advance
 *                  (order leaves the caller's queue, dialog closes)
 *   onUpdated   – (updatedOrder) => void  — called after any mid-flow change
 *                  that does NOT hand the order to the next step: "Teslim
 *                  Alındı" (handleMatbaaReceive), the printer's "İşlemi
 *                  Başlatın" (handleStartOzalit), and either answer to a
 *                  change request. Required wherever this dialog is mounted,
 *                  not just on the receipt-gate queues: the printer's own
 *                  "Teslim Edin" button is gated on order.ozalit_started, so
 *                  a caller that skips onUpdated leaves the dialog rendering
 *                  the pre-start snapshot and the round can never be
 *                  delivered.
 *                  Callers should MERGE the reply over the row they hold
 *                  ({ ...row, ...updated }) rather than replacing it — every
 *                  mutation route returns order_requests' own columns only,
 *                  without the list query's joined project_title /
 *                  requested_by_name / order_history.
 *   initialReject – open straight into the reject panel (skipping the
 *                  approve-first click) — used by the list's own "Reddet"
 *                  button. Ignored when the step offers no reject route.
 */
export default function TalepSignDialog({ order, open, onOpenChange, onSigned, onUpdated, initialReject = false }) {
  const { user } = useAuth()
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  // Designer step 1 of 2 (status 'tasarimciya_atandi', migration 054) — "Kontrolleri
  // Yapın": alt görevler + ürün bilgileri. Step 2 ("Ozalit İsteyin", status
  // 'kontroller_tamam') isn't this dialog at all: it opens the Ozalit Üretim
  // Formu, and that form's own submit advances the order.
  const isDesignerStep = user?.role === 'designer' && order?.status === 'tasarimciya_atandi'
  // Team leader can also correct the spec while approving the ozalit round
  // (imza_bekleniyor), the digital Ekran Onayı, or — before the matbaa has
  // started work — the pending matbaa_ozalit_yapiyor delivery itself (migration
  // 051's cancel/edit window; once started, direct editing is refused and
  // the request-change flow further down takes over instead). Same as the
  // main project pipeline's own Ozalit form, where the team leader may
  // always edit the spec regardless of stage. Designer/printer stay
  // view-only at these steps, same as on the main pipeline.
  const canEditSpec =
    isDesignerStep ||
    (user?.role === 'team_leader' && (order?.status === 'imza_bekleniyor' || order?.status === 'ekran_onayinda')) ||
    (user?.role === 'team_leader' && order?.status === 'matbaa_ozalit_yapiyor' && !order?.ozalit_started)
  // The resubmit-after-reject choice (another physical ozalit vs. a digital
  // Ekran Onayı) used to live here. It moved one step forward with migration
  // 054, onto the Ozalit Üretim Formu that now makes the request — see
  // SpecFormDialog's authoringOrderOzalit footer. The checks step never picks
  // a route, and the server refuses one sent from here.
  const [comps, setComps] = useState([])
  const [editorOpen, setEditorOpen] = useState(false)
  // Team-leader reject of the sales-side ozalit (matbaa teslim).
  const [showReject, setShowReject] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  // Which part re-does the rejected ozalit: 'designer' (→ görüldü), 'matbaa'
  // (→ tasarımcı onayı / re-delivery), or 'reassign' (→ back to pending so the
  // leader can pick a new team). Only shown when the step offers a choice.
  const [rejectRoute, setRejectRoute] = useState('matbaa')
  // Which alt görevler the designer has to redo, when rejecting to 'designer'.
  // Optional: an empty selection still rejects — it just says "send it back"
  // without naming a part.
  const [revizeIds, setRevizeIds] = useState([])
  const [rejectSubtasks, setRejectSubtasks] = useState([])
  // Assign step (pending → görüldü): team leader picks the designer(s) for the check.
  const isAssignStep = user?.role === 'team_leader' && order?.status === 'atama_bekleniyor'
  // Only the team leader can reject, and only at a step that offers a route.
  // Declared up here (not next to the other derived labels below) because the
  // reject-picker effect depends on it, and effects must run before this
  // component's `if (!order) return null` guard.
  const canReject = !!ORDER_REJECT_TO[order?.status] && user?.role === 'team_leader'
  const [designers, setDesigners] = useState([])
  const [assignIds, setAssignIds] = useState([])
  const [subtasks, setSubtasks] = useState([])
  const [subsOpen, setSubsOpen] = useState(false)
  const originalRef = useRef('[]')
  const originalSubsRef = useRef('[]')
  // Mirror of SpecFormDialog's `noChangesToSend`: when the dialog opens with
  // the sipariş spec editable and the leader doesn't edit anything before
  // clicking "Düzeltmeyi Matbaaya Gönderin", the button greys out so a
  // notification can't go out with an empty diff to review.
  const noCatalogChanges = JSON.stringify(comps) === originalRef.current

  /* Every action on the order's ozalit round — the printer's start/answer,
     the leader's cancel/edit/request-change, and the imza_bekleniyor receipt
     gate. See hooks/useOrderOzalitRound.js. */
  const {
    ozalitBusy, changeNote, setChangeNote,
    matbaaBusy, confirmMatbaaNotReceived, setConfirmMatbaaNotReceived,
    handleStartOzalit, handleSaveOzalitEdit, handleCancelOzalit,
    handleRequestOzalitChange, handleAcceptOzalitChange, handleDeclineOzalitChange,
    handleMatbaaReceive, handleMatbaaNotReceived,
  } = useOrderOzalitRound({ order, user, comps, originalRef, open, onSigned, onUpdated, onOpenChange })

  useEffect(() => {
    if (open && order && canEditSpec) {
      const loaded = deepClone(loadProductComps(order.project_id))
      setComps(loaded)
      originalRef.current = JSON.stringify(loaded)
      setEditorOpen(false)
      if (isDesignerStep) {
        // Subtasks first (open); product info collapsed until needed.
        // Team-leader steps (imza_bekleniyor/ekran_onay) don't touch alt
        // görevler here — only the designer's own review step does.
        setSubsOpen(true)
        // This order's own alt görevler snapshot (order_subtasks) — already
        // embedded on the order object from GET /order-requests, no fetch
        // needed, and no risk of reading another concurrent order's rows.
        const subs = deepClone(order.subtasks ?? [])
        setSubtasks(subs)
        originalSubsRef.current = JSON.stringify(subs)
      }
      let cancelled = false
      // Pull the authoritative spec from the server (the cache may be cold on
      // this browser) and prime the shared cache so every view agrees.
      api.getProductInfo(order.project_id)
        .then((comps) => {
          if (cancelled) return
          primeProductInfoCache([{ project_id: order.project_id, components: comps }])
          const fresh = deepClone(comps)
          setComps(fresh)
          originalRef.current = JSON.stringify(fresh)
        })
        .catch(() => {})
      return () => { cancelled = true }
    }
    // Deliberately keyed on order?.id, not order?.subtasks — this should
    // seed local edit state once when the dialog opens for this order, not
    // reset in-progress edits every time the order object is refetched
    // elsewhere (polling, onSigned/onUpdated) while the dialog stays open.
  }, [open, order?.id, canEditSpec, isDesignerStep])

  // Prime the leader's reject picker from the order's own alt görevler
  // snapshot, and reset the selection each time the dialog reopens so a
  // previous rejection's choices can't leak into the next one. Keyed on
  // order?.id (not order?.subtasks) for the same reason as the designer-step
  // effect above — don't clear an in-progress selection on a background
  // order refresh.
  useEffect(() => {
    if (!(open && order && canReject)) return
    setRevizeIds([])
    setRejectSubtasks(order.subtasks ?? [])
    // Default to the first target this step actually offers — 'matbaa'
    // isn't a valid route at ekran_onay (no physical proof was ever
    // delivered there), so a stale 'matbaa' default would silently pick an
    // invalid route.
    const targets = ORDER_REJECT_TARGETS[order.status] ?? {}
    setRejectRoute(targets.matbaa ? 'matbaa' : Object.keys(targets)[0])
    if (initialReject) setShowReject(true)
  }, [open, order?.id, canReject, initialReject])

  // Load designers + default selection (the project's current designers) when
  // the team leader is on the assign step.
  useEffect(() => {
    if (!(open && order && isAssignStep)) return
    let cancelled = false
    Promise.all([api.listUsers(), api.getProject(order.project_id)])
      .then(([users, p]) => {
        if (cancelled) return
        setDesigners(users.filter((u) => u.role === 'designer' && u.is_active !== false))
        setAssignIds((p.assignees ?? []).map((a) => a.id))
      })
      .catch(() => {})
    // Live-refresh the assignee selection if the project is reassigned
    // somewhere else (another tab / another leader). Without this the leader
    // could sign with a stale selection that no longer matches the project.
    const unsubscribe = api.subscribeProjects?.((updated) => {
      if (cancelled) return
      if (updated?.id !== order.project_id) return
      setAssignIds((updated.assignees ?? []).map((a) => a.id))
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [open, order?.id, order?.project_id, isAssignStep])

  if (!order) return null

  const nextStep = ORDER_STEP_NEXT[order.status]
  const nextLabel = ORDER_STEP_LABELS[nextStep] ?? 'Onayla'
  const currentStepLabel = ORDER_STEP_LABELS[order.status] ?? order.status

  // imza_bekleniyor is multi-party, leader-first — full parity with the main
  // pipeline's ozalit_onay gate (see domain/constants/orders.js). Nobody can
  // approve until the delivered proof is "Teslim Alındı", and a designer only
  // counter-signs once a team leader has. A click here never claims finality
  // ("Son Onay") — the client can't see the full required-approver set, only
  // whether ITS OWN vote clears; the server decides when the round is done.
  const isMatbaaOnayStep = order.status === 'imza_bekleniyor'
  const isAssignedMatbaaDesigner =
    user?.role === 'designer' && (order.assignee_ids ?? []).includes(user?.id)
  const canActOnMatbaaOnay = isMatbaaOnayStep && (user?.role === 'team_leader' || isAssignedMatbaaDesigner)
  const matbaaReceived = !!order.matbaa_received
  const matbaaAwaitingLeader =
    isMatbaaOnayStep && isAssignedMatbaaDesigner && !matbaaOnayLeaderApproved(order)
  const matbaaAlreadyApproved =
    isMatbaaOnayStep && (order.matbaa_approvals ?? []).some((a) => a.id === user?.id)

  // Full parity with the main pipeline's demo/ozalit started/cancel/edit/
  // change-request flow (migrations 048/049), scoped to the order's own
  // ozalit round delivered at matbaa_ozalit_yapiyor (migration 051). Team-leader
  // only, same restriction as the main pipeline (avoids two people racing
  // to edit/notify the same sent request).
  const isTasarimciOnayStep = order.status === 'matbaa_ozalit_yapiyor'
  const ozalitStarted = !!order.ozalit_started
  const ozalitChangePending = order.ozalit_change_requested_at != null
  const ozalitFixPending = !!order.ozalit_fix_pending
  const canCancelOrEditOzalit =
    user?.role === 'team_leader' && isTasarimciOnayStep && !ozalitStarted && !ozalitChangePending
  const canRequestOzalitChange =
    user?.role === 'team_leader' && isTasarimciOnayStep && ozalitStarted && !ozalitChangePending
  const canRespondOzalitChange =
    user?.role === 'printer' && isTasarimciOnayStep && ozalitChangePending

  // Non-designer steps each have their own plain-language action, matching the
  // trigger button that opened this dialog — no "İmzala" wording, no pen icon.
  const actionLabel = isAssignStep
    ? 'Tasarımcıya Aktarın'
    : order.status === 'matbaa_ozalit_yapiyor'
      ? 'Teslim Edin'
      : order.status === 'ekran_onayinda'
        ? 'Onaylayın'
      : isMatbaaOnayStep
        ? 'Onaylayın'
        : 'Son Onay'

  const items = normalizeItems(order.items, order.quantity)
  // Only completed alt görevler can be sent back for revision — an unfinished
  // one is already on the designer's plate. Kind-aware: an İç Sayfalar subtask
  // is "done" via pages_done, not is_done.
  const revisableSubtasks = rejectSubtasks.filter((s) => s.kind !== 'revize' && isSubtaskDone(s))

  async function handleSign(e) {
    e.preventDefault()
    if (!user) return
    if (isAssignStep && assignIds.length === 0) {
      toast.error('En az bir tasarımcı seçin.')
      return
    }
    // Re-validate the assignee selection against the current user list before
    // submitting. Catches the case where a teammate was deactivated in
    // another tab while this dialog was open — without this, the request
    // would still go through and the server would 400 mid-flight with a less
    // friendly message.
    if (isAssignStep) {
      const stillActive = new Set(
        designers.filter((d) => d.is_active !== false).map((d) => d.id),
      )
      const stale = assignIds.filter((id) => !stillActive.has(id))
      if (stale.length > 0) {
        toast.error('Seçili tasarımcılardan biri artık aktif değil. Listeyi yenileyin.')
        return
      }
    }
    setSaving(true)
    try {
      let signNotes = notes.trim()
      // Deferred, not applied: `advanceOrderRequest` below carries an
      // expectedVersion optimistic-lock check, so a refusal here is routine
      // — someone else signed this step first. Writing the spec and the
      // subtask flags up front meant that refusal still left both changed,
      // under a bare "İşlem başarısız" toast. Nothing is written until the
      // advance has passed the lock.
      const pendingWrites = []
      if (canEditSpec) {
        const compsChanged = JSON.stringify(comps) !== originalRef.current
        const parts = []
        // Only write when the spec actually changed. An unconditional PUT
        // re-stamps product_info.updated_by/updated_at with whoever happened
        // to sign, so Ürün Bilgileri's "last edited by …" credited an edit
        // nobody made — and the sign note below is built from the same flag,
        // so the two would disagree.
        if (compsChanged) {
          pendingWrites.push(() => saveProductComps(order.project_id, comps))
          parts.push('ürün bilgileri')
        }
        if (isDesignerStep) {
          const subsChanged = JSON.stringify(subtasks) !== originalSubsRef.current
          if (subsChanged) pendingWrites.push(() => saveSubtaskFlags(order.id, subtasks, originalSubsRef.current))
          if (subsChanged) parts.push('alt görevler')
        }
        if (parts.length) {
          const phrase = `${parts.join(' ve ')} güncellendi`
          signNotes = signNotes ? `${signNotes} · ${phrase}` : phrase
        }
      }
      if (isAssignStep) {
        const names = designers.filter((d) => assignIds.includes(d.id)).map((d) => d.name).join(', ')
        if (names) signNotes = signNotes ? `${signNotes} · ${names} görevlendirildi` : `${names} görevlendirildi`
      }
      const updated = await api.advanceOrderRequest(order.id, {
        actor: { id: user.id, name: user.name, role: user.role },
        notes: signNotes,
        expectedVersion: order.version ?? null,
        ...(isAssignStep ? { assignees: assignIds } : {}),
      })
      // The advance passed the version check, so the edits it described in
      // `signNotes` may now be committed.
      for (const write of pendingWrites) await write()
      // A imza_bekleniyor click doesn't always complete the round — the client
      // can't tell in advance whether its own vote is the last one needed
      // (see the note above actionLabel), so it checks the server's answer.
      if (isMatbaaOnayStep && updated.status === order.status) {
        toast.success('Onayınız kaydedildi, diğer onaylar bekleniyor.')
      } else if (isDesignerStep) {
        // Half of the designer's turn, not the end of it — say what's next
        // rather than announcing the bare step name ("Kontrol Edildi").
        toast.success('Kontroller kaydedildi, şimdi ozalit isteyin.')
      } else {
        toast.success(`${nextLabel}.`)
      }
      setNotes('')
      onOpenChange(false)
      onSigned?.(updated)
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    } finally {
      setSaving(false)
    }
  }

  async function handleReject() {
    if (!user) return
    if (!rejectReason.trim()) {
      toast.error('Red sebebi zorunludur.')
      return
    }
    setSaving(true)
    try {
      const updated = await api.rejectOrderRequest(order.id, {
        actor: { id: user.id, name: user.name, role: user.role },
        reason: rejectReason.trim(),
        routeTo: rejectRoute,
        revizeIds: rejectRoute === 'designer' ? revizeIds : [],
        expectedVersion: order.version ?? null,
      })
      toast.success(
        rejectRoute === 'designer'
          ? revizeIds.length > 0
            ? `Baskı ozaliti reddedildi, ${revizeIds.length} alt görev revize için tasarımcıya gönderildi.`
            : 'Baskı ozaliti reddedildi, tasarımcıya geri gönderildi.'
          : rejectRoute === 'reassign'
          ? 'Baskı reddedildi, tasarımcı kadrosu yeniden seçilecek.'
          : 'Baskı ozaliti reddedildi, matbaaya geri gönderildi.',
      )
      setRejectReason('')
      setRejectRoute('matbaa')
      setRevizeIds([])
      setShowReject(false)
      onOpenChange(false)
      onSigned?.(updated)
    } catch (err) {
      toast.error(err.message || 'Reddetme başarısız.')
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    if (saving) return
    setNotes('')
    setShowReject(false)
    setRejectReason('')
    setRejectRoute('matbaa')
    setAssignIds([])
    onOpenChange(false)
  }

  // imza_bekleniyor's receipt gate has exactly one useful action before receipt
  // is acknowledged — the approve button stays disabled until then, and
  // rejecting the ozalit only makes sense once it's actually been seen. So
  // skip the full approval form (cart summary, pipeline, signature, notes —
  // all irrelevant here) and ask the one question that matters.
  if (canActOnMatbaaOnay && !matbaaReceived && !showReject && !initialReject) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ozalit Teslim Alma</DialogTitle>
            <DialogDescription>{order.project_title?.replace(/ \/ /g, ' ')}</DialogDescription>
          </DialogHeader>

          {confirmMatbaaNotReceived ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Matbaa teslimi hiç ulaşmadı mı? Talep, yeniden teslim için matbaaya geri gönderilecek.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setConfirmMatbaaNotReceived(false)} disabled={matbaaBusy}>
                  Vazgeç
                </Button>
                <Button type="button" variant="destructive" onClick={handleMatbaaNotReceived} disabled={matbaaBusy}>
                  {matbaaBusy ? 'İşleniyor…' : 'Evet, ulaşmadı'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">Ozaliti teslim aldınız mı?</p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmMatbaaNotReceived(true)}>
                    Teslim Alınamadı
                  </Button>
                  {canReject && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowReject(true)}>
                      Reddedin
                    </Button>
                  )}
                </div>
                <Button type="button" variant="success" onClick={handleMatbaaReceive} disabled={matbaaBusy}>
                  <Check className="h-4 w-4" />
                  {matbaaBusy ? 'İşleniyor…' : 'Evet, teslim aldım'}
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={handleClose} disabled={matbaaBusy}>
              İptal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={cn('max-w-md', DIALOG_MOBILE_SHEET, canEditSpec && 'max-w-lg')}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDesignerStep ? 'Kontrolleri Yapın' : actionLabel}
          </DialogTitle>
          <DialogDescription>
            {isDesignerStep
              ? 'Alt görevleri güncelleyin, gerekirse ürün bilgilerini düzeltin. Kaydettikten sonra ozalit isteme adımına geçeceksiniz.'
              : 'Bu adımı onaylayarak imzalıyorsunuz. İşlem geri alınamaz.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSign} className="space-y-4">
          <TalepOrderSummary order={order} items={items} />

          <MiniPipeline order={order} nextStep={nextStep} />

          {/* Designer-only: edit the project's subtasks (alt görevler) — first */}
          {isDesignerStep && (
            <SubtaskPanel
              subtasks={subtasks}
              onChange={setSubtasks}
              open={subsOpen}
              onToggle={() => setSubsOpen((v) => !v)}
            />
          )}

          {/* Designer at tasarimciya_atandi, team leader approving imza_bekleniyor/
              ekran_onay, or team leader at a not-yet-started matbaa_ozalit_yapiyor:
              edit the product spec (collapsed by default) — mirrors the main
              pipeline's Ozalit form, where the team leader may correct the
              spec right up through approval. */}
          {canEditSpec && (
            <ProductInfoPanel
              comps={comps}
              onChangeComp={(ci, nc) => setComps((prev) => prev.map((x, i) => (i === ci ? nc : x)))}
              items={items}
              quantity={order.quantity}
              open={editorOpen}
              onToggle={() => setEditorOpen((v) => !v)}
            />
          )}

          {isAssignStep && (
            <TalepAssignDesigners
              designers={designers}
              assignIds={assignIds}
              onToggle={(id) =>
                setAssignIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
              }
            />
          )}

          {/* Signature block removed for now (previously shown here on every
              non-designer step). */}

          <div className="space-y-1.5">
            <Label htmlFor="sign-notes">Not (isteğe bağlı)</Label>
            <Textarea
              id="sign-notes"
              rows={2}
              placeholder="Bu adıma ait notunuzu yazın…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-none text-sm"
            />
          </div>

          {/* Team-leader reject of the sales-side ozalit */}
          {canReject && showReject && (
            <TalepRejectForm
              order={order}
              route={rejectRoute}
              onRouteChange={setRejectRoute}
              revisableSubtasks={revisableSubtasks}
              revizeIds={revizeIds}
              onToggleRevize={(id) =>
                setRevizeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
              }
              reason={rejectReason}
              onReasonChange={setRejectReason}
            />
          )}

          {isTasarimciOnayStep && !showReject && (
            <TalepOzalitPanel
              order={order}
              user={user}
              ozalitBusy={ozalitBusy}
              ozalitStarted={ozalitStarted}
              ozalitChangePending={ozalitChangePending}
              ozalitFixPending={ozalitFixPending}
              canRespondOzalitChange={canRespondOzalitChange}
              canRequestOzalitChange={canRequestOzalitChange}
              canCancelOrEditOzalit={canCancelOrEditOzalit}
              changeNote={changeNote}
              onChangeNote={setChangeNote}
              noCatalogChanges={noCatalogChanges}
              onStartOzalit={handleStartOzalit}
              onAcceptOzalitChange={handleAcceptOzalitChange}
              onDeclineOzalitChange={handleDeclineOzalitChange}
              onRequestOzalitChange={handleRequestOzalitChange}
              onCancelOzalit={handleCancelOzalit}
              onSaveOzalitEdit={handleSaveOzalitEdit}
            />
          )}

          {canActOnMatbaaOnay && !showReject && matbaaReceived && (
            <TalepMatbaaReceiptBanner
              order={order}
              matbaaAwaitingLeader={matbaaAwaitingLeader}
              matbaaAlreadyApproved={matbaaAlreadyApproved}
            />
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {canReject && !showReject && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setShowReject(true)}
                  disabled={saving}
                >
                  <X className="h-4 w-4" />
                  Reddedin
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={handleClose} disabled={saving}>
                İptal
              </Button>
              {showReject ? (
                <Button type="button" variant="destructive" onClick={handleReject} disabled={saving}>
                  <X className="h-4 w-4" />
                  {saving ? 'Reddediliyor…' : 'Reddi Onaylayın'}
                </Button>
              ) : (
                // matbaa_ozalit_yapiyor belongs to the printer — a team leader viewing
                // it only ever gets the cancel/edit/change-request actions
                // above, never this generic advance button. And same as the
                // main pipeline's demo/ozalit Teslim Et: hidden for the
                // printer until İşlemi Başlatın has been pressed, and while a
                // change request is pending (respond to it above instead).
                !(user?.role === 'team_leader' && isTasarimciOnayStep) &&
                !(user?.role === 'printer' && isTasarimciOnayStep && (!ozalitStarted || ozalitChangePending)) && (
                  <Button
                    type="submit"
                    disabled={
                      saving ||
                      (isMatbaaOnayStep && (!canApproveMatbaaOnayNow(user, order) || matbaaAlreadyApproved)) ||
                      canRespondOzalitChange
                    }
                  >
                    {saving ? 'Kaydediliyor…' : isDesignerStep ? 'Kontrolleri Yapın' : actionLabel}
                  </Button>
                )
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────

function normalizeItems(items, quantity) {
  if (!Array.isArray(items) || items.length === 0) return []
  if (typeof items[0] === 'string') return items.map((name) => ({ name, quantity }))
  return items
}
