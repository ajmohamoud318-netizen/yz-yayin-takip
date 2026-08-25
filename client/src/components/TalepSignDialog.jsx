import { useState, useEffect, useRef } from 'react'
import { ShoppingCart, ChevronDown, Package, Pencil, Plus, X, Check, ListChecks, FileText, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import api, {
  ORDER_STEP_LABELS, ORDER_STEP_NEXT, ORDER_REJECT_TO, ORDER_REJECT_TARGETS,
  ORDER_STEP_PATH_DEFAULT, orderStepPath,
  canApproveMatbaaOnayNow, matbaaOnayLeaderApproved,
} from '@/api'
import { getComponentsForProject, saveComponentsForProject, primeProductInfoCache } from '@/data/productCatalog'
import { buildAdetRows } from '@/data/orderAdet'
import { useAuth } from '@/hooks/useAuth'
import { useDesignerCelebration } from '@/hooks/useCelebration'
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
import { cn, formatNumber } from '@/lib/utils'

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

// Per-subtask fields PATCH /api/order-requests/:orderId/subtasks/:id accepts
// from the designer.
const SUBTASK_PATCH_FIELDS = ['needs_revize', 'is_done', 'pages_done', 'stickers_done']

/**
 * Persist the designer's Revize flags by PATCHing only the rows that actually
 * changed.
 *
 * These are `order_subtasks` rows — this order's own snapshot of the
 * project's alt görevler (migration 039), not the shared `subtasks` table —
 * so two concurrent orders on the same project never see or overwrite each
 * other's rework tracking.
 *
 * This deliberately does NOT use `PUT /projects/:id/subtasks`. That endpoint
 * replaces the whole list and belongs to the team leader, who owns the list's
 * SHAPE (titles, kinds, totals, assignment). Sending this dialog's rows there
 * failed three ways: the rows carry server-side fields (`id`, `position`,
 * `assigned_name`, timestamps) that its additionalProperties:false schema
 * rejects with a 400; the route is team_leader-only, so a designer got a 403;
 * and it never persisted `needs_revize` anyway — the one field this editor
 * exists to set. The net effect was that a designer who touched alt görevler
 * could not sign at all, while their ürün bilgileri edit (saved just above)
 * had already gone through.
 */
async function saveSubtaskFlags(orderId, subtasks, originalJson) {
  const before = new Map(JSON.parse(originalJson).map((s) => [s.id, s]))
  for (const s of subtasks) {
    const prev = before.get(s.id)
    // Rows with no id were never persisted; the list shape is the leader's to
    // change, so this dialog only ever updates existing subtasks.
    if (!s.id || !prev) continue
    const patch = {}
    for (const f of SUBTASK_PATCH_FIELDS) {
      if (s[f] === prev[f]) continue
      // `pages_done`/`stickers_done` are integers server-side; a null (a
      // counter that was never started) is not a value the schema accepts.
      if (f === 'pages_done' || f === 'stickers_done') {
        if (!Number.isFinite(s[f])) continue
      }
      patch[f] = s[f]
    }
    if (Object.keys(patch).length > 0) await api.updateOrderSubtask(orderId, s.id, patch)
  }
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
 *   onUpdated   – (updatedOrder) => void  — called after "Teslim Alındı"
 *                  (mid-flow state change; the dialog still closes itself,
 *                  this just keeps the caller's list row in sync — see
 *                  handleMatbaaReceive)
 *   initialReject – open straight into the reject panel (skipping the
 *                  approve-first click) — used by the list's own "Reddet"
 *                  button. Ignored when the step offers no reject route.
 */
export default function TalepSignDialog({ order, open, onOpenChange, onSigned, onUpdated, initialReject = false }) {
  const { user } = useAuth()
  const celebrate = useDesignerCelebration()
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  // matbaa_onay receipt gate — "Teslim Alındı" / "Teslim Alınamadı".
  const [matbaaBusy, setMatbaaBusy] = useState(false)
  const [confirmMatbaaNotReceived, setConfirmMatbaaNotReceived] = useState(false)
  // Designer step (status 'goruldu') can revise the product spec before signing.
  const isDesignerStep = user?.role === 'designer' && order?.status === 'goruldu'
  // Team leader can also correct the spec while approving the ozalit round
  // (matbaa_onay), the digital Ekran Onayı, or — before the matbaa has
  // started work — the pending tasarimci_onay delivery itself (migration
  // 051's cancel/edit window; once started, direct editing is refused and
  // the request-change flow further down takes over instead). Same as the
  // main project pipeline's own Ozalit form, where the team leader may
  // always edit the spec regardless of stage. Designer/printer stay
  // view-only at these steps, same as on the main pipeline.
  const canEditSpec =
    isDesignerStep ||
    (user?.role === 'team_leader' && (order?.status === 'matbaa_onay' || order?.status === 'ekran_onay')) ||
    (user?.role === 'team_leader' && order?.status === 'tasarimci_onay' && !order?.ozalit_started)
  // Resubmit-after-reject: only once this order has actually bounced back to
  // goruldu via a reject (order.last_reject_type === 'designer') does the
  // designer get to choose between another physical ozalit and a digital
  // Ekran Onayı — a first submission always goes straight to tasarimci_onay,
  // no choice offered.
  const isResubmit = isDesignerStep && order?.last_reject_type === 'designer'
  const [chosenRoute, setChosenRoute] = useState(null)
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
  const isAssignStep = user?.role === 'team_leader' && order?.status === 'pending'
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

  useEffect(() => {
    if (open && order && canEditSpec) {
      setChosenRoute(null)
      const loaded = deepClone(loadProductComps(order.project_id))
      setComps(loaded)
      originalRef.current = JSON.stringify(loaded)
      setEditorOpen(false)
      if (isDesignerStep) {
        // Subtasks first (open); product info collapsed until needed.
        // Team-leader steps (matbaa_onay/ekran_onay) don't touch alt
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

  // Each (re)open starts the receipt-gate confirm prompts collapsed — a
  // stale "are you sure" from a previously opened order shouldn't carry over.
  useEffect(() => {
    if (!open) return
    setConfirmMatbaaNotReceived(false)
  }, [open, order?.id])

  if (!order) return null

  const nextStep = ORDER_STEP_NEXT[order.status]
  const nextLabel = ORDER_STEP_LABELS[nextStep] ?? 'Onayla'
  const currentStepLabel = ORDER_STEP_LABELS[order.status] ?? order.status

  // matbaa_onay is multi-party, leader-first — full parity with the main
  // pipeline's ozalit_onay gate (see domain/constants/orders.js). Nobody can
  // approve until the delivered proof is "Teslim Alındı", and a designer only
  // counter-signs once a team leader has. A click here never claims finality
  // ("Son Onay") — the client can't see the full required-approver set, only
  // whether ITS OWN vote clears; the server decides when the round is done.
  const isMatbaaOnayStep = order.status === 'matbaa_onay'
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
  // ozalit round delivered at tasarimci_onay (migration 051). Team-leader
  // only, same restriction as the main pipeline (avoids two people racing
  // to edit/notify the same sent request).
  const isTasarimciOnayStep = order.status === 'tasarimci_onay'
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
    : order.status === 'tasarimci_onay'
      ? 'Teslim Edin'
      : order.status === 'ekran_onay'
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
    if (isResubmit && !chosenRoute) {
      toast.error('Revize sonrası Ozalit mi yoksa Ekran Onayı mı isteneceğini seçin.')
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
      if (canEditSpec) {
        await saveProductComps(order.project_id, comps)
        const compsChanged = JSON.stringify(comps) !== originalRef.current
        const parts = []
        if (compsChanged) parts.push('ürün bilgileri')
        if (isDesignerStep) {
          const subsChanged = JSON.stringify(subtasks) !== originalSubsRef.current
          if (subsChanged) await saveSubtaskFlags(order.id, subtasks, originalSubsRef.current)
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
        ...(isResubmit ? { route: chosenRoute } : {}),
      })
      // A matbaa_onay click doesn't always complete the round — the client
      // can't tell in advance whether its own vote is the last one needed
      // (see the note above actionLabel), so it checks the server's answer.
      if (isMatbaaOnayStep && updated.status === order.status) {
        toast.success('Onayınız kaydedildi, diğer onaylar bekleniyor.')
      } else {
        toast.success(`${nextLabel}.`)
      }
      if (isDesignerStep) celebrate()
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

  // Full parity with the main pipeline's demo/ozalit started/cancel/edit/
  // change-request flow (migrations 048/049), scoped to the order's own
  // ozalit round delivered at tasarimci_onay (migration 051).
  const [ozalitBusy, setOzalitBusy] = useState(false)
  const [changeNote, setChangeNote] = useState('')

  // Matbaa marks physical work begun — after this, the team leader's free
  // cancel/edit closes and a change request is required instead.
  async function handleStartOzalit() {
    setOzalitBusy(true)
    try {
      const updated = await api.startOrderOzalit(order.id)
      toast.success('Başlatıldı olarak işaretlendi.')
      onUpdated?.(updated)
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    } finally {
      setOzalitBusy(false)
    }
  }

  // Team leader edits the product spec while it's still sitting with the
  // matbaa, pre-start — saves to the shared Ürün Bilgileri catalog (same
  // path the designer's own goruldu edit uses) and logs+notifies via the
  // dedicated route, since this step's generic submit belongs to the
  // printer (the owner of tasarimci_onay), not the leader.
  async function handleSaveOzalitEdit() {
    setOzalitBusy(true)
    try {
      await saveProductComps(order.project_id, comps)
      const updated = await api.notifyOrderOzalitEdit(order.id)
      toast.success('Ürün bilgileri güncellendi, matbaa bilgilendirildi.')
      onOpenChange(false)
      onUpdated?.(updated)
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    } finally {
      setOzalitBusy(false)
    }
  }

  // Team leader cancels a pending (not-yet-started) ozalit request outright
  // — closes the dialog and sends the order back to goruldu.
  async function handleCancelOzalit() {
    setOzalitBusy(true)
    try {
      const updated = await api.cancelOrderOzalit(order.id)
      toast.success('Ozalit talebi iptal edildi.')
      onOpenChange(false)
      onSigned?.(updated)
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    } finally {
      setOzalitBusy(false)
    }
  }

  // Team leader asks the matbaa to accept a cancel/edit once they've already
  // started — doesn't close the dialog, the round stays at tasarimci_onay
  // either way until the printer responds.
  async function handleRequestOzalitChange() {
    setOzalitBusy(true)
    try {
      const updated = await api.requestOrderOzalitChange(order.id, changeNote.trim())
      toast.success('Değişiklik talebiniz matbaaya iletildi.')
      setChangeNote('')
      onUpdated?.(updated)
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    } finally {
      setOzalitBusy(false)
    }
  }

  // Matbaa accepts the pending change-request — un-starts the round so the
  // leader's free cancel/edit reopens.
  async function handleAcceptOzalitChange() {
    setOzalitBusy(true)
    try {
      const updated = await api.acceptOrderOzalitChange(order.id)
      toast.success('Değişiklik talebi kabul edildi.')
      onUpdated?.(updated)
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    } finally {
      setOzalitBusy(false)
    }
  }

  // Matbaa declines — round stays started, nothing else changes.
  async function handleDeclineOzalitChange() {
    setOzalitBusy(true)
    try {
      const updated = await api.declineOrderOzalitChange(order.id)
      toast.success('Değişiklik talebi reddedildi.')
      onUpdated?.(updated)
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    } finally {
      setOzalitBusy(false)
    }
  }

  // "Teslim Alındı" — the matbaa_onay receipt gate. This is a one-question
  // dialog (see the compact early-return render below), so it closes once
  // answered rather than chaining into the full approval form — approving is
  // a separate, deliberate action the user takes later via the list's own
  // "Onayla" button. Not onSigned: the order hasn't left the queue, just
  // picked up matbaa_received, so onUpdated pushes the fresh order back up
  // to keep the parent's list in sync.
  async function handleMatbaaReceive() {
    setMatbaaBusy(true)
    try {
      const updated = await api.matbaaReceiveOrder(order.id)
      toast.success('Matbaa ozaliti teslim alındı.')
      onUpdated?.(updated)
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    } finally {
      setMatbaaBusy(false)
    }
  }

  // "Teslim Alınamadı" — the counterpart. The order actually leaves
  // matbaa_onay here (back to tasarimci_onay for re-delivery), so this DOES
  // close the dialog and call onSigned, same as a rejection.
  async function handleMatbaaNotReceived() {
    setMatbaaBusy(true)
    try {
      const updated = await api.matbaaNotReceivedOrder(order.id)
      toast.success('Matbaa teslimi alınamadı, matbaaya geri gönderildi.')
      setConfirmMatbaaNotReceived(false)
      onOpenChange(false)
      onSigned?.(updated)
    } catch (err) {
      toast.error(err.message || 'İşlem başarısız.')
    } finally {
      setMatbaaBusy(false)
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

  // matbaa_onay's receipt gate has exactly one useful action before receipt
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
            {isDesignerStep ? 'İnceleyin ve Gönderin' : actionLabel}
          </DialogTitle>
          <DialogDescription>
            {isDesignerStep
              ? 'Önce alt görevleri güncelleyin; gerekirse ürün bilgilerini düzenleyin, ardından gönderin.'
              : 'Bu adımı onaylayarak imzalıyorsunuz. İşlem geri alınamaz.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSign} className="space-y-4">
          {/* Order summary */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <ShoppingCart className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-snug">
                  {order.project_title?.replace(/ \/ /g, ' ')}
                </p>
                {items.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {items.map((item) => (
                      <span
                        key={item.name}
                        className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                      >
                        {item.name}
                        <span className="font-normal text-primary/70">
                          · {formatNumber(item.quantity)}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatNumber(order.quantity)} adet
                  </p>
                )}
                {order.notes && (
                  <p className="mt-0.5 text-xs text-muted-foreground">Not: {order.notes}</p>
                )}
              </div>
            </div>
          </div>

          {/* Mini-pipeline progress */}
          <MiniPipeline order={order} nextStep={nextStep} />

          {/* Designer-only: edit the project's subtasks (alt görevler) — first */}
          {isDesignerStep && (
            <div className="overflow-hidden rounded-lg border">
              <button
                type="button"
                onClick={() => setSubsOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
              >
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <ListChecks className="h-3.5 w-3.5" />
                  Alt Görevler
                  {subtasks.filter((s) => s.needs_revize).length > 0 && (
                    <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-700">
                      {subtasks.filter((s) => s.needs_revize).length} revize
                    </span>
                  )}
                </span>
                <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', subsOpen && 'rotate-180')} />
              </button>
              {subsOpen && (
                <div className="border-t bg-muted/20 p-2">
                  <SubtaskEditor subtasks={subtasks} onChange={setSubtasks} />
                </div>
              )}
            </div>
          )}

          {/* Designer at goruldu, team leader approving matbaa_onay/
              ekran_onay, or team leader at a not-yet-started tasarimci_onay:
              edit the product spec (collapsed by default) — mirrors the main
              pipeline's Ozalit form, where the team leader may correct the
              spec right up through approval. */}
          {canEditSpec && (
            <div className="overflow-hidden rounded-lg border">
              <button
                type="button"
                onClick={() => setEditorOpen((v) => !v)}
                className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Pencil className="h-3.5 w-3.5 shrink-0" />
                    Ürün Bilgileri
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {items.length > 0
                      ? items.map((it) => (
                          <span key={it.name} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground/80">
                            {it.name}
                            <span className="text-muted-foreground">{formatNumber(it.quantity)} adet</span>
                          </span>
                        ))
                      : order.quantity != null && (
                          <span className="inline-flex items-center whitespace-nowrap rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground/80">
                            {formatNumber(order.quantity)} adet
                          </span>
                        )}
                  </div>
                </div>
                <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200', editorOpen && 'rotate-180')} />
              </button>
              {editorOpen && (
                <div className="space-y-2 border-t bg-muted/20 p-2">
                  {comps.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">Bu ürün için bilgi yok.</p>
                  ) : (
                    comps.map((c, ci) => (
                      <EditableComp
                        key={ci}
                        comp={c}
                        onChange={(nc) => setComps((prev) => prev.map((x, i) => (i === ci ? nc : x)))}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* Resubmit-after-reject: choose another physical ozalit or a
              digital Ekran Onayı. Only shown once this order has actually
              bounced back to goruldu via a reject — a first submission has
              no choice, it always goes to tasarimci_onay. */}
          {isResubmit && (
            <div className="space-y-1.5">
              <Label>Nasıl onaylatmak istersiniz? *</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setChosenRoute('tasarimci_onay')}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left transition',
                    chosenRoute === 'tasarimci_onay'
                      ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/30'
                      : 'hover:bg-muted/50',
                  )}
                >
                  <span className="block text-sm font-semibold">Tekrar Ozalit İsteyin</span>
                  <span className="block text-xs text-muted-foreground">Matbaa fiziksel ozalit basar</span>
                </button>
                <button
                  type="button"
                  onClick={() => setChosenRoute('ekran_onay')}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left transition',
                    chosenRoute === 'ekran_onay'
                      ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/30'
                      : 'hover:bg-muted/50',
                  )}
                >
                  <span className="block text-sm font-semibold">Ekran Onayı İsteyin</span>
                  <span className="block text-xs text-muted-foreground">Ekip lideri ekrandan onaylar</span>
                </button>
              </div>
            </div>
          )}

          {/* Assign step: pick the designer(s) who will check this run */}
          {isAssignStep && (
            <div className="space-y-1.5">
              <Label>Tasarımcı(lar), kim kontrol edecek? *</Label>
              <p className="text-xs text-muted-foreground">
                Bu baskıyı orijinal tasarımcı(lar)a veya farklı birine atayabilirsiniz.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {designers.map((d) => {
                  const sel = assignIds.includes(d.id)
                  return (
                    <button
                      type="button"
                      key={d.id}
                      onClick={() =>
                        setAssignIds((prev) =>
                          prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id],
                        )
                      }
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                        sel
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-muted/50',
                      )}
                    >
                      {sel && <Check className="h-3 w-3" />}
                      {d.name}
                    </button>
                  )
                })}
                {designers.length === 0 && (
                  <span className="text-xs text-muted-foreground">Aktif tasarımcı bulunamadı.</span>
                )}
              </div>
            </div>
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
            <div className="space-y-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              {/* Route choice: who re-does the rejected ozalit? Only the
                  targets this step actually offers are shown — ekran_onay
                  never touched a physical proof, so it has no 'matbaa'
                  option, and no 'reassign' either. */}
              {ORDER_REJECT_TARGETS[order.status] && (
                <div className="space-y-1.5">
                  <Label className="text-destructive">Kime geri gönderilsin?</Label>
                  <div
                    className="grid gap-2"
                    style={{ gridTemplateColumns: `repeat(${Object.keys(ORDER_REJECT_TARGETS[order.status]).length}, 1fr)` }}
                  >
                    {ORDER_REJECT_TARGETS[order.status].designer && (
                      <button
                        type="button"
                        onClick={() => setRejectRoute('designer')}
                        className={cn(
                          'rounded-lg border px-3 py-2 text-left transition',
                          rejectRoute === 'designer'
                            ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/30'
                            : 'hover:bg-muted/50',
                        )}
                      >
                        <span className="block text-sm font-semibold">Tasarımcı</span>
                        <span className="block text-xs text-muted-foreground">Tasarımı yeniden düzenler</span>
                      </button>
                    )}
                    {ORDER_REJECT_TARGETS[order.status].matbaa && (
                      <button
                        type="button"
                        onClick={() => setRejectRoute('matbaa')}
                        className={cn(
                          'rounded-lg border px-3 py-2 text-left transition',
                          rejectRoute === 'matbaa'
                            ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/30'
                            : 'hover:bg-muted/50',
                        )}
                      >
                        <span className="block text-sm font-semibold">Matbaa</span>
                        <span className="block text-xs text-muted-foreground">Yeniden teslim eder</span>
                      </button>
                    )}
                    {ORDER_REJECT_TARGETS[order.status].reassign && (
                      <button
                        type="button"
                        onClick={() => setRejectRoute('reassign')}
                        className={cn(
                          'rounded-lg border px-3 py-2 text-left transition',
                          rejectRoute === 'reassign'
                            ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/30'
                            : 'hover:bg-muted/50',
                        )}
                      >
                        <span className="block text-sm font-semibold">Kadro değişsin</span>
                        <span className="block text-xs text-muted-foreground">Tasarımcıyı yeniden seçer</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
              {/* Which alt görevler have to be redone. Mirrors the demo/ozalit
                  rejection picker in ApprovalDialog. */}
              {rejectRoute === 'designer' && revisableSubtasks.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-destructive">
                    Revize Edilecek Alt Görevler{' '}
                    <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Yalnızca tamamlanmış görevler revize edilebilir. Seçtikleriniz tasarımcıya
                    revize olarak işaretlenir; seçmezseniz talep sadece geri gönderilir.
                  </p>
                  <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-md border bg-background p-2">
                    {revisableSubtasks.map((s) => {
                      const checked = revizeIds.includes(s.id)
                      return (
                        <label
                          key={s.id}
                          className={cn(
                            'flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 text-sm transition',
                            checked ? 'border-amber-300 bg-amber-50' : 'border-transparent hover:bg-muted/50',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setRevizeIds((prev) =>
                                prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                              )
                            }
                            className="h-4 w-4 accent-amber-500"
                          />
                          <span className={cn('min-w-0 flex-1', checked && 'font-medium text-amber-800')}>
                            {s.title}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="reject-reason" className="text-destructive">Red Sebebi *</Label>
                <Textarea
                  id="reject-reason"
                  rows={2}
                  placeholder="Ozalitin neden reddedildiğini yazın…"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="resize-none text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {rejectRoute === 'designer'
                    ? 'Tasarımcıya geri gönderilir; tasarımı revize eder. Ozalit deneme sayacı artar.'
                    : rejectRoute === 'reassign'
                    ? 'Talep başa sarılır; takım lideri tasarımcı kadrosunu yeniden seçer. Ozalit deneme sayacı artar.'
                    : 'Matbaaya geri gönderilir; yeni bir Ozalit teslim edilir. Tasarım değişmez. Ozalit deneme sayacı artar.'}
                </p>
              </div>
            </div>
          )}

          {/* tasarimci_onay: printer's "İşlemi Başlatın" + change-request
              accept/decline, or the team leader's cancel/save-edit/
              request-change — migration 051, full parity with the main
              pipeline's demo/ozalit started flow (migrations 048/049). */}
          {isTasarimciOnayStep && !showReject && (
            <div className="space-y-2.5">
              {user?.role === 'printer' && !ozalitChangePending && (ozalitStarted || !ozalitFixPending) && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                  <span>
                    {ozalitStarted
                      ? 'İşe başladığınız işaretlendi.'
                      : 'Fiziksel işe başladığınızda işaretleyin — ekip lideri bundan sonra iptal/düzenleme yerine değişiklik talebi gönderir.'}
                  </span>
                  {!ozalitStarted && (
                    <Button type="button" size="sm" variant="outline" onClick={handleStartOzalit} disabled={ozalitBusy}>
                      {ozalitBusy ? 'İşleniyor…' : 'İşlemi Başlatın'}
                    </Button>
                  )}
                </div>
              )}

              {/* Fix owed, printer's turn to wait — the İşlemi Başlatın block
                  above hides itself here, so without this the printer's
                  panel goes silently empty with no clue why. */}
              {user?.role === 'printer' && !ozalitChangePending && !ozalitStarted && ozalitFixPending && (
                <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  <Check className="h-4 w-4 shrink-0" />
                  <span>Değişiklik talebini kabul ettiniz, ekip liderinin düzeltmeyi göndermesi bekleniyor.</span>
                </div>
              )}

              {canRespondOzalitChange && (
                <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  <p>
                    Ekip lideri değişiklik istedi
                    {order.ozalit_change_requested_note ? `: "${order.ozalit_change_requested_note}"` : '.'}
                  </p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="destructive" onClick={handleDeclineOzalitChange} disabled={ozalitBusy}>
                      Reddedin
                    </Button>
                    <Button type="button" size="sm" variant="success" onClick={handleAcceptOzalitChange} disabled={ozalitBusy}>
                      Kabul Edin
                    </Button>
                  </div>
                </div>
              )}

              {user?.role === 'team_leader' && ozalitChangePending && (
                <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  <Check className="h-4 w-4 shrink-0" />
                  <span>Değişiklik talebiniz matbaada bekliyor.</span>
                </div>
              )}

              {canRequestOzalitChange && (
                <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">
                    Matbaa ozalite başladı — doğrudan iptal veya düzenleme artık yapılamaz, bir değişiklik talebi gönderin.
                  </p>
                  <Textarea
                    rows={2}
                    placeholder="Değişiklik notu (isteğe bağlı)…"
                    value={changeNote}
                    onChange={(e) => setChangeNote(e.target.value)}
                    className="resize-none text-sm"
                  />
                  <Button type="button" size="sm" variant="outline" onClick={handleRequestOzalitChange} disabled={ozalitBusy}>
                    {ozalitBusy ? 'Gönderiliyor…' : 'Değişiklik İsteyin'}
                  </Button>
                </div>
              )}

              {canCancelOrEditOzalit && (
                <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">
                    Matbaa henüz başlamadı — ürün bilgilerini yukarıdan düzenleyip kaydedebilir, veya talebi doğrudan iptal edebilirsiniz.
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button" size="sm" variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={handleCancelOzalit} disabled={ozalitBusy}
                    >
                      İptal Edin
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={handleSaveOzalitEdit} disabled={ozalitBusy}>
                      {ozalitBusy ? 'Kaydediliyor…' : 'Kaydedin'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* matbaa_onay receipt gate — the approve button below stays
              disabled until the proof is acknowledged. The "not yet
              received" state itself is handled by the compact early-return
              dialog above; by the time this form renders, receipt has
              already been confirmed (or this is the reject flow, where the
              gate is irrelevant and hidden via !showReject). */}
          {canActOnMatbaaOnay && !showReject && matbaaReceived && (
            matbaaAwaitingLeader ? (
              <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                <Check className="h-4 w-4 shrink-0" />
                <span>
                  Matbaa ozaliti teslim alındı{order.matbaa_received_by ? `, ${order.matbaa_received_by}` : ''}.
                  Onay sırası ekip liderinde, o onayladıktan sonra onaylayabilirsiniz.
                </span>
              </div>
            ) : matbaaAlreadyApproved ? (
              <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
                <Check className="h-4 w-4 shrink-0" />
                <span>Onayınızı verdiniz, diğer onaylar bekleniyor.</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
                <Check className="h-4 w-4 shrink-0" />
                <span>
                  Matbaa ozaliti teslim alındı{order.matbaa_received_by ? `, ${order.matbaa_received_by}` : ''}. Onaylayabilirsiniz.
                </span>
              </div>
            )
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
                // tasarimci_onay belongs to the printer — a team leader viewing
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
                    {saving ? 'Kaydediliyor…' : isDesignerStep ? 'İnceleyin ve Gönderin' : actionLabel}
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

function SignedStepRow({ step, onForm }) {
  const date = step.signed_at
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(step.signed_at))
    : '—'
  return (
    <button
      type="button"
      onClick={onForm}
      className="block w-full rounded-lg border bg-white px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {step.step_label}
        </p>
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600">
          <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          İmzalandı
        </span>
      </div>
      <div className="mt-2 flex min-h-[2.5rem] items-end border-b border-foreground/25 pb-0.5">
        {step.signed_by_name && (
          <span style={{ fontFamily: "'Alex Brush', cursive", fontSize: '1.35rem', color: 'hsl(325 21% 20% / 0.8)' }}>
            {step.signed_by_name}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{roleLabel(step.signed_by_role)} · İmza</span>
        <span>{date}</span>
      </div>
      {step.notes && (
        <p className="mt-1.5 text-xs italic text-muted-foreground">"{step.notes}"</p>
      )}
      <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary">
        <FileText className="h-3 w-3" />
        Formu Gör
      </span>
    </button>
  )
}

// ── Order-step progress helpers ──────────────────────────────────────────────
// An order's TRUE position is its current `status`, NOT whatever lingers in
// order_history. A rejection loops the order backward (e.g. matbaa_onay →
// goruldu) yet leaves the old forward entries in history; deriving state
// from `status` makes rolled-back steps correctly render as "not yet reached"
// instead of falsely showing as signed.
function reachedStepIndex(order) {
  return orderStepPath(order).indexOf(order?.status)
}

function PendingStepRow({ step }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-3 opacity-60">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {ORDER_STEP_LABELS[step] ?? step}
      </p>
      <div className="mt-2 flex min-h-[2.5rem] items-end border-b border-dashed border-foreground/15 pb-0.5" />
      <p className="mt-1 text-[10px] text-muted-foreground">Bekliyor…</p>
    </div>
  )
}

function MiniPipeline({ order, nextStep }) {
  const allSteps = orderStepPath(order)
  const reached = reachedStepIndex(order)
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-1">
      {allSteps.map((step, i) => {
        const done = i <= reached
        const isNext = step === nextStep
        const label = stepShortLabel(step)
        return (
          <div key={step} className="flex min-w-0 items-center">
            <div className={cn(
              'flex h-6 min-w-0 shrink-0 items-center justify-center rounded-full px-2 text-[10px] font-semibold whitespace-nowrap',
              done ? 'bg-emerald-100 text-emerald-700' : isNext ? 'bg-primary/10 text-primary ring-1 ring-primary/30' : 'bg-muted text-muted-foreground/50',
            )}>
              {label}
            </div>
            {i < allSteps.length - 1 && (
              <span className={cn('mx-0.5 h-px w-3 shrink-0', done ? 'bg-emerald-300' : 'bg-border')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── designer inline spec editor ──────────────────────────────────────────────
function EditableComp({ comp, onChange }) {
  const fields = comp.fields ?? []
  const setField = (i, patch) => onChange({ ...comp, fields: fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) })
  const addField = () => onChange({ ...comp, fields: [...fields, { k: '', v: '' }] })
  const removeField = (i) => onChange({ ...comp, fields: fields.filter((_, idx) => idx !== i) })

  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <div className="border-b bg-muted/30 px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-widest text-foreground">
        {comp.component}
      </div>
      <div className="px-2 py-1">
        {fields.map((f, i) => (
          <div key={i} className="flex items-center gap-1.5 border-b py-1 last:border-b-0">
            <input
              value={f.k}
              onChange={(e) => setField(i, { k: e.target.value })}
              placeholder="ALAN"
              className="w-24 shrink-0 bg-transparent text-[11px] font-semibold uppercase tracking-wide outline-none placeholder:text-muted-foreground/50"
            />
            <span className="text-xs font-bold text-muted-foreground">:</span>
            <input
              value={f.v}
              onChange={(e) => setField(i, { v: e.target.value })}
              placeholder="Değer"
              className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/50"
            />
            <button
              type="button"
              onClick={() => removeField(i)}
              aria-label="Satırı sil"
              className="shrink-0 rounded p-0.5 text-muted-foreground transition active:scale-90 hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addField}
          className="mt-1 inline-flex items-center gap-1 px-1 py-1 text-[11px] font-semibold text-primary transition active:scale-95 hover:opacity-80"
        >
          <Plus className="h-3 w-3" /> Satır Ekle
        </button>
      </div>
    </div>
  )
}

// ── designer inline subtask (alt görev) editor ───────────────────────────────
/**
 * Reprint-check subtask list. The work is already complete, so this is NOT a
 * done/undone checklist — the designer flags which subtasks need revision for
 * this run. Marking "Revize" sets needs_revize and drops the item from done
 * (so the rework shows up); unmarking restores it as complete.
 */
function SubtaskEditor({ subtasks, onChange }) {
  const set = (i, patch) => onChange(subtasks.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  const toggleRevize = (i) => {
    const s = subtasks[i]
    const flag = !s.needs_revize
    if (flag) {
      const patch = { needs_revize: true, is_done: false, done_at: null }
      if (s.kind === 'pages') patch.pages_done = 0
      if (s.kind === 'sticker-count') patch.stickers_done = 0
      set(i, patch)
    } else {
      const patch = { needs_revize: false, is_done: true, done_at: new Date().toISOString() }
      if (s.kind === 'pages') patch.pages_done = s.total_pages ?? 0
      if (s.kind === 'sticker-count') patch.stickers_done = s.total_stickers ?? 0
      set(i, patch)
    }
  }
  const revizeCount = subtasks.filter((s) => s.needs_revize).length

  return (
    <div className="space-y-1">
      <p className="px-1 pb-1 text-[11px] text-muted-foreground">
        Revize ettiğiniz alt görevleri işaretleyin.{' '}
        {revizeCount > 0 ? `${revizeCount} görev revize edildi.` : 'İşaretlenen yok, her şey hazır.'}
      </p>
      {subtasks.length === 0 ? (
        <p className="px-2 py-3 text-center text-xs text-muted-foreground">Bu projede alt görev yok.</p>
      ) : (
        subtasks.map((s, i) => {
          const flagged = !!s.needs_revize
          return (
            <div
              key={s.id ?? i}
              className={cn(
                'flex items-center gap-2 rounded-md border px-2 py-1.5',
                flagged ? 'border-amber-300 bg-amber-50' : 'bg-white',
              )}
            >
              <span className={cn('min-w-0 flex-1 text-[13px]', flagged && 'font-medium text-amber-800')}>
                {s.title}
              </span>
              <button
                type="button"
                onClick={() => toggleRevize(i)}
                aria-pressed={flagged}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition active:scale-95',
                  flagged
                    ? 'border-amber-400 bg-amber-100 text-amber-700'
                    : 'border-input text-muted-foreground hover:border-amber-300 hover:text-amber-700',
                )}
              >
                <RefreshCw className="h-3 w-3" />
                {flagged ? 'Revize edildi' : 'Revize'}
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────

function normalizeItems(items, quantity) {
  if (!Array.isArray(items) || items.length === 0) return []
  if (typeof items[0] === 'string') return items.map((name) => ({ name, quantity }))
  return items
}

function stepShortLabel(step) {
  const map = {
    pending: 'Talep',
    goruldu: 'Aktarıldı',
    tasarimci_onay: 'Ozalit',
    ekran_onay: 'Ekran Onayı',
    matbaa_onay: 'Onay',
    siparis_baski_onay: 'Baskı Onayı',
    onaylandi: 'Üretimde',
  }
  return map[step] ?? step
}

function roleLabel(role) {
  const map = {
    team_leader: 'Takım Lideri',
    designer: 'Tasarımcı',
    printer: 'Matbaa',
    satis: 'Satış Ekibi',
  }
  return map[role] ?? role
}
