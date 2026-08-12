import { useState, useEffect, useRef } from 'react'
import { PenLine, ShoppingCart, ChevronDown, ChevronLeft, Package, Pencil, Plus, X, Check, ListChecks, Printer, FileText, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import api, { ORDER_STEP_LABELS, ORDER_STEP_NEXT, ORDER_REJECT_TO, ORDER_REJECT_TARGETS } from '@/api'
import { getComponentsForProject, saveComponentsForProject, primeProductInfoCache } from '@/data/productCatalog'
import { buildAdetRows } from '@/data/orderAdet'
import { useAuth } from '@/hooks/useAuth'
import { useDesignerCelebration } from '@/hooks/useCelebration'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

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
 */
export default function TalepSignDialog({ order, open, onOpenChange, onSigned }) {
  const { user } = useAuth()
  const celebrate = useDesignerCelebration()
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  // Designer step (status 'goruldu') can revise the product spec before signing.
  const isDesignerStep = user?.role === 'designer' && order?.status === 'goruldu'
  const [comps, setComps] = useState([])
  const [editorOpen, setEditorOpen] = useState(false)
  // Team-leader reject of the sales-side ozalit (matbaa teslim).
  const [showReject, setShowReject] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  // Which part re-does the rejected ozalit: 'designer' (→ görüldü), 'matbaa'
  // (→ tasarımcı onayı / re-delivery), or 'reassign' (→ back to pending so the
  // leader can pick a new team). Only shown when the step offers a choice.
  const [rejectRoute, setRejectRoute] = useState('matbaa')
  // Assign step (pending → görüldü): team leader picks the designer(s) for the check.
  const isAssignStep = user?.role === 'team_leader' && order?.status === 'pending'
  const [designers, setDesigners] = useState([])
  const [assignIds, setAssignIds] = useState([])
  const [subtasks, setSubtasks] = useState([])
  const [subsOpen, setSubsOpen] = useState(false)
  const originalRef = useRef('[]')
  const originalSubsRef = useRef('[]')

  useEffect(() => {
    if (open && order && isDesignerStep) {
      const loaded = deepClone(loadProductComps(order.project_id))
      setComps(loaded)
      originalRef.current = JSON.stringify(loaded)
      // Subtasks first (open); product info collapsed until needed.
      setSubsOpen(true)
      setEditorOpen(false)
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
      api.getProject(order.project_id)
        .then((p) => {
          if (cancelled) return
          const subs = deepClone(p.subtasks ?? [])
          setSubtasks(subs)
          originalSubsRef.current = JSON.stringify(subs)
        })
        .catch(() => {})
      return () => { cancelled = true }
    }
  }, [open, order?.id, isDesignerStep])

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
  // Only the team leader can reject, and only at the ozalit approval step.
  const canReject = !!ORDER_REJECT_TO[order.status] && user?.role === 'team_leader'

  const items = normalizeItems(order.items, order.quantity)

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
      if (isDesignerStep) {
        await saveProductComps(order.project_id, comps)
        const compsChanged = JSON.stringify(comps) !== originalRef.current
        const subsChanged = JSON.stringify(subtasks) !== originalSubsRef.current
        if (subsChanged) await api.saveProjectSubtasks(order.project_id, subtasks)
        const parts = []
        if (compsChanged) parts.push('ürün bilgileri')
        if (subsChanged) parts.push('alt görevler')
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
      toast.success(`${nextLabel} — İmzalandı.`)
      if (isDesignerStep) celebrate()
      setNotes('')
      onOpenChange(false)
      onSigned?.(updated)
    } catch (err) {
      toast.error(err.message || 'İmzalama başarısız.')
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
        expectedVersion: order.version ?? null,
      })
      toast.success(
        rejectRoute === 'designer'
          ? 'Sipariş ozaliti reddedildi — tasarımcıya geri gönderildi.'
          : rejectRoute === 'reassign'
          ? 'Sipariş reddedildi — tasarımcı kadrosu yeniden seçilecek.'
          : 'Sipariş ozaliti reddedildi — matbaaya geri gönderildi.',
      )
      setRejectReason('')
      setRejectRoute('matbaa')
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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={cn('max-w-md max-sm:left-0 max-sm:top-0 max-sm:h-screen max-sm:max-h-screen max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none', isDesignerStep && 'max-w-lg max-h-[90vh] overflow-y-auto')}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="h-4 w-4" />
            {isDesignerStep ? 'İncele ve Gönder' : `İmzala — ${nextLabel}`}
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
                          · {item.quantity.toLocaleString('tr-TR')}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {order.quantity?.toLocaleString('tr-TR')} adet
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

          {/* Designer-only: edit the product spec (collapsed by default) */}
          {isDesignerStep && (
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
                            <span className="text-muted-foreground">{it.quantity.toLocaleString('tr-TR')} adet</span>
                          </span>
                        ))
                      : order.quantity != null && (
                          <span className="inline-flex items-center whitespace-nowrap rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground/80">
                            {order.quantity.toLocaleString('tr-TR')} adet
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

          {/* Assign step: pick the designer(s) who will check this run */}
          {isAssignStep && (
            <div className="space-y-1.5">
              <Label>Tasarımcı(lar) — kim kontrol edecek? *</Label>
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

          {/* Signature block — not shown on the designer review step */}
          {!isDesignerStep && (
            <div className="rounded-lg border-2 border-dashed border-primary/20 bg-primary/5 p-3 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-primary/60">
                İmza
              </p>
              <p className="text-sm font-semibold text-foreground">{user?.name}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {roleLabel(user?.role)} · {new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
          )}

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
              {/* Route choice: who re-does the rejected ozalit? */}
              {ORDER_REJECT_TARGETS[order.status] && (
                <div className="space-y-1.5">
                  <Label className="text-destructive">Kime geri gönderilsin?</Label>
                  <div className="grid grid-cols-3 gap-2">
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
                  Reddet
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
                  {saving ? 'Reddediliyor…' : 'Reddi Onayla'}
                </Button>
              ) : (
                <Button type="submit" disabled={saving}>
                  <PenLine className="h-4 w-4" />
                  {saving ? 'İmzalanıyor…' : isDesignerStep ? 'İncele ve Gönder' : `İmzala — ${nextLabel}`}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Signed-step viewer (read-only, used inside order cards) ──────────────────
export function TalepHistoryViewer({ order, open, onOpenChange, initialStep = null }) {
  const [viewStep, setViewStep] = useState(null)
  // When opened for a specific stage, jump straight to that stage's signed form.
  useEffect(() => {
    if (!open) { setViewStep(null); return }
    if (initialStep && order) {
      const entry = (order.order_history ?? []).find((h) => h.step === initialStep)
      setViewStep(entry ?? null)
    }
  }, [open, initialStep, order?.id])
  if (!order) return null

  const items = normalizeItems(order.items, order.quantity)
  const created = order.created_at ? new Date(order.created_at) : null
  const dateStr = created
    ? new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(created)
    : '—'
  const timeStr = created
    ? new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(created)
    : '—'

  // The requested item is the book / project itself; its sub-catalog (Kitap,
  // Kutu, Ses…) is listed beneath when the order has components.
  const bookTitle = order.project_title?.replace(/ \/ /g, ' ') ?? ''
  const hasSub = items.length > 0
  const totalQty = order.quantity ?? items.reduce((n, it) => Math.max(n, it.quantity || 0), 0)
  const MIN_ROWS = 8
  const tableRows = [
    { quantity: hasSub ? null : totalQty, name: bookTitle, sub: false },
    ...items.map((it) => ({ quantity: it.quantity, name: it.name, sub: true })),
  ]
  while (tableRows.length < MIN_ROWS) tableRows.push(null)

  const steps = order.order_history ?? []
  const pending = pendingFutureSteps(order)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto max-sm:left-0 max-sm:top-0 max-sm:h-screen max-sm:max-h-screen max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" />
            Sipariş Formu — {bookTitle}
          </DialogTitle>
          <DialogDescription>
            {viewStep
              ? 'Bu aşamada imzalanan form.'
              : 'Aşamaları görüntüleyin; her aşamanın imzalı formunu açın.'}
          </DialogDescription>
        </DialogHeader>

        {viewStep ? (
          /* ── A single stage and its signed form ── */
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setViewStep(null)}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Aşamalara dön
            </button>
            {(viewStep.step === 'tasarimci_onay' || viewStep.step === 'matbaa_onay') ? (
              <OzalitStepSheet order={order} step={viewStep.step} footer={<StepSignatureFooter step={viewStep.step} order={order} />} />
            ) : (
              <OrderSheet
                order={order}
                tableRows={tableRows}
                dateStr={dateStr}
                timeStr={timeStr}
                footer={<StepSignatureFooter step={viewStep.step} order={order} />}
              />
            )}
          </div>
        ) : (
          /* ── Horizontal stage pipeline — click a signed stage for its form ── */
          <div className="space-y-2">
            <HorizontalStages order={order} onSelect={(h) => setViewStep(h)} />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Kapat</Button>
          <Button variant="outline" onClick={() => openOrderPrintWindow(order, viewStep?.step)}>
            <Printer className="h-4 w-4" />
            Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* Formal order sheet (letterhead + Miktar/Cinsi table) with a pluggable footer. */
function OrderSheet({ order, tableRows, dateStr, timeStr, footer }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      {/* Letterhead */}
      <div className="border-b px-6 py-5 text-center">
        <img src="/yz_blacklogo.svg" alt="Yükselen Zeka" width={120} height={36} loading="lazy" decoding="async" className="mx-auto h-9 w-auto object-contain" />
        <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Yükselen Zeka Yayıncılık
        </p>
        <h2 className="mt-3 text-xl font-bold uppercase tracking-[0.18em] text-foreground">
          Sipariş Formu
        </h2>
      </div>

      {/* Meta line */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b px-6 py-3">
        <div className="text-sm">
          <p className="text-[11px] text-muted-foreground">Sipariş Veren</p>
          <p className="font-semibold">{order.requested_by_name}</p>
        </div>
        <div className="text-right text-xs leading-relaxed">
          <p><span className="text-muted-foreground">Sipariş Tarihi : </span><span className="font-medium">{dateStr}</span></p>
          <p><span className="text-muted-foreground">Sipariş Saati : </span><span className="font-medium">{timeStr}</span></p>
        </div>
      </div>

      {/* Items table */}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="w-28 border-r px-3 py-2 text-center font-semibold">Miktar</th>
            <th className="px-3 py-2 text-left font-semibold">Cinsi</th>
          </tr>
        </thead>
        <tbody>
          {tableRows.map((it, i) => (
            <tr key={i} className="border-b last:border-b-0">
              <td className="border-r px-3 py-2 text-center tabular-nums">
                {it && it.quantity != null ? it.quantity.toLocaleString('tr-TR') : ' '}
              </td>
              <td className="px-3 py-2">
                {it ? (
                  it.sub ? (
                    <span className="pl-4 text-muted-foreground">– {it.name}</span>
                  ) : (
                    <span className="font-semibold">{it.name}</span>
                  )
                ) : ' '}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {order.notes && (
        <div className="border-t px-6 py-2 text-xs text-muted-foreground">
          Not: {order.notes}
        </div>
      )}

      {footer}
    </div>
  )
}

/* Ozalit-style sheet for the tasarimci_onay and matbaa_onay steps.
   Shows the product specs from the catalog but replaces each component's ADET
   field value with the quantity Esra requested in the sipariş. */
function OzalitStepSheet({ order, step, footer }) {
  const comps = loadProductComps(order.project_id)

  // Map component name → Esra's ordered quantity for that component
  const orderItems = normalizeItems(order.items, order.quantity)
  const qtyForComp = (compName) => {
    if (orderItems.length > 0) {
      const match = orderItems.find(
        (it) => it.name?.toUpperCase() === compName?.toUpperCase()
      )
      // Fall back to the first item if no name match (single-item orders)
      const qty = (match ?? orderItems[0])?.quantity
      return qty != null ? qty.toLocaleString('tr-TR') : null
    }
    return order.quantity != null ? order.quantity.toLocaleString('tr-TR') : null
  }

  const created = order.created_at ? new Date(order.created_at) : null
  const dateStr = created
    ? new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(created)
    : '—'

  const stepLabel = step === 'tasarimci_onay' ? 'Tasarımcı → Matbaa' : 'Matbaa Teslimi'

  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      {/* Letterhead */}
      <div className="border-b px-6 py-5 text-center">
        <img src="/yz_blacklogo.svg" alt="Yükselen Zeka" width={120} height={36} loading="lazy" decoding="async" className="mx-auto h-9 w-auto object-contain" />
        <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Yükselen Zeka Yayıncılık
        </p>
        <h2 className="mt-3 text-xl font-bold uppercase tracking-[0.18em] text-foreground">
          Ozalit Üretim Formu
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{stepLabel}</p>
      </div>

      {/* Meta */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b px-6 py-3">
        <div className="text-sm">
          <p className="text-[11px] text-muted-foreground">İşin Adı</p>
          <p className="font-semibold">{order.project_title?.replace(/ \/ /g, ' ')}</p>
        </div>
        <div className="text-right text-xs leading-relaxed">
          <p><span className="text-muted-foreground">Sipariş Tarihi : </span><span className="font-medium">{dateStr}</span></p>
          <p><span className="text-muted-foreground">Sipariş Veren : </span><span className="font-medium">{order.requested_by_name}</span></p>
        </div>
      </div>

      {/* Spec table: all catalog fields, ADET value replaced with Esra's order */}
      {comps.length > 0 ? (
        comps.map((comp, ci) => {
          const orderedQty = qtyForComp(comp.component)
          const fields = (comp.fields ?? []).filter((f) => f.k?.toUpperCase() !== 'İŞİN ADI')
          return (
            <div key={ci} className={ci > 0 ? 'border-t' : ''}>
              <div className="border-b bg-muted/20 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-foreground">
                {comp.component}
              </div>
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {fields.map((f, i) => {
                    const isAdet = f.k?.toUpperCase() === 'ADET'
                    const displayValue = isAdet && orderedQty != null ? orderedQty : (f.v ?? '')
                    return (
                      <tr key={i} className="border-b last:border-b-0">
                        <td className="w-2/5 border-r px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {f.k}
                        </td>
                        <td className="px-4 py-2 text-sm">
                          {displayValue}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })
      ) : (
        /* Fallback when no catalog data: show ordered quantity + notes */
        <table className="w-full border-collapse text-sm">
          <tbody>
            {order.quantity != null && (
              <tr className="border-b">
                <td className="w-2/5 border-r px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Adet</td>
                <td className="px-4 py-2 text-sm">{order.quantity.toLocaleString('tr-TR')}</td>
              </tr>
            )}
            {order.notes && (
              <tr className="border-b">
                <td className="w-2/5 border-r px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Not</td>
                <td className="px-4 py-2 text-sm text-muted-foreground">{order.notes}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {footer}
    </div>
  )
}

/* Per-step signature block. Each step shows different signatories:
   pending       → Esra (sipariş veren) only
   goruldu       → Ekip Lideri + Esra
   tasarimci_onay→ Ekip Lideri + Tasarımcı
   matbaa_onay   → Matbaa Yetkilisi only
   onaylandi     → Ekip Lideri + Tasarımcı + Matbaa Yetkilisi (all except Esra) */
function StepSignatureFooter({ step, order }) {
  const history = order?.order_history ?? []
  // Latest NON-reject signer for a step: a rejection reuses the target step's
  // name, so filtering reject entries keeps the rejecter off the approver's line,
  // and taking the last valid entry reflects the newest signature after a re-sign.
  const signer = (s) =>
    history.filter((h) => h.step === s && h.action !== 'reject').pop()?.signed_by_name ?? ''
  const esra = order?.requested_by_name ?? ''
  const gorulduSigner = signer('goruldu')
  const tasarimciSigner = signer('tasarimci_onay')
  const matbaaSigner = signer('matbaa_onay')
  const leaderSigner = signer('onaylandi') || gorulduSigner

  const configs = {
    pending:        [{ role: 'Sipariş Veren', name: esra }],
    goruldu:        [{ role: 'Ekip Lideri', name: gorulduSigner }, { role: 'Sipariş Veren', name: esra }],
    tasarimci_onay: [{ role: 'Ekip Lideri', name: gorulduSigner }, { role: 'Tasarımcı', name: tasarimciSigner }],
    matbaa_onay:    [{ role: 'Matbaa Yetkilisi', name: matbaaSigner }],
    onaylandi:      [{ role: 'Ekip Lideri', name: leaderSigner }, { role: 'Tasarımcı', name: tasarimciSigner }, { role: 'Matbaa Yetkilisi', name: matbaaSigner }],
  }

  const cells = configs[step] ?? []
  return (
    <div
      className="divide-x border-t"
      style={{ display: 'grid', gridTemplateColumns: `repeat(${cells.length}, 1fr)` }}
    >
      {cells.map((c) => (
        <div key={c.role} className="px-3 py-3">
          <p className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{c.role}</p>
          <div className="mt-2 flex min-h-[3rem] items-end justify-center border-b border-foreground/25 pb-0.5">
            {c.name && (
              <span style={{ fontFamily: "'Alex Brush', cursive", fontSize: '1.35rem', color: 'hsl(325 21% 20% / 0.8)' }}>
                {c.name}
              </span>
            )}
          </div>
          <p className="mt-1 text-center text-[10px] text-muted-foreground">İmza</p>
        </div>
      ))}
    </div>
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

const STAGE_DEFS = [
  { step: 'pending',         label: 'Sipariş Talebi', color: '#e11d48' },
  { step: 'goruldu',         label: 'Ön İnceleme',    color: '#f97316' },
  { step: 'tasarimci_onay',  label: 'Ozalit İstendi', color: '#10b981' },
  { step: 'matbaa_onay',     label: 'Matbaa Teslimi', color: '#3b82f6' },
  { step: 'onaylandi',       label: 'Üretimde',       color: '#8b5cf6' },
]

// ── Order-step progress helpers ──────────────────────────────────────────────
// An order's TRUE position is its current `status`, NOT whatever lingers in
// order_history. A rejection loops the order backward (e.g. matbaa_onay →
// tasarimci_onay) yet leaves the old forward entries in history; deriving state
// from `status` makes rolled-back steps correctly render as "not yet reached"
// instead of falsely showing as signed.
const ORDER_STEP_SEQUENCE = ['pending', 'goruldu', 'tasarimci_onay', 'matbaa_onay', 'onaylandi']

function reachedStepIndex(order) {
  return ORDER_STEP_SEQUENCE.indexOf(order?.status)
}

// Latest NON-reject signature entry per step. A rejection reuses the target
// step's name (a matbaa_onay reject writes a `tasarimci_onay` entry), so
// excluding reject entries keeps the rejecter's signature from masquerading as
// the original approver's on that step.
function signedEntriesByStep(order) {
  return Object.fromEntries(
    (order?.order_history ?? [])
      .filter((h) => h.action !== 'reject')
      .map((h) => [h.step, h]),
  )
}

/* Horizontal connected-circle pipeline (like a project-stage process graphic). */
function HorizontalStages({ order, onSelect }) {
  const byStep = signedEntriesByStep(order)
  const reached = reachedStepIndex(order)
  const last = STAGE_DEFS.length - 1
  // The active step is the one right after the furthest step actually reached.
  const activeIndex = reached + 1

  return (
    <div className="overflow-x-auto px-1 pb-1 pt-3">
      <div className="flex min-w-[480px]">
        {STAGE_DEFS.map((d, i) => {
          const entry = byStep[d.step]
          const done = i <= reached
          const isActive = i === activeIndex
          const prev = STAGE_DEFS[i - 1]
          const prevDone = i > 0 && i - 1 <= reached
          const date = done && entry?.signed_at
            ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(new Date(entry.signed_at))
            : null

          return (
            <div key={d.step} className="relative flex flex-1 flex-col items-center">
              {/* connectors (centered on the node row) */}
              {i > 0 && (
                <span
                  className="absolute left-0 right-1/2 top-5 h-0.5 -translate-y-1/2 rounded-full transition-colors"
                  style={{
                    background: prevDone
                      ? `linear-gradient(90deg, ${prev.color}, ${done ? d.color : prev.color})`
                      : '#e8eaed',
                  }}
                />
              )}
              {i < last && (
                <span
                  className="absolute left-1/2 right-0 top-5 h-0.5 -translate-y-1/2 rounded-full transition-colors"
                  style={{ background: done ? d.color : '#e8eaed' }}
                />
              )}

              {/* node */}
              <button
                type="button"
                disabled={!done || !entry}
                onClick={done && entry ? () => onSelect(entry) : undefined}
                aria-label={d.label}
                className={cn(
                  'group relative z-10 grid h-10 w-10 place-items-center rounded-full transition-all duration-200',
                  done
                    ? 'cursor-pointer text-white shadow-sm hover:-translate-y-0.5 hover:shadow-md'
                    : 'cursor-default bg-white',
                )}
                style={
                  done
                    ? { background: d.color, boxShadow: `0 1px 2px ${d.color}55, 0 0 0 4px ${d.color}1a` }
                    : isActive
                      ? { boxShadow: `0 0 0 2px ${d.color}, 0 0 0 6px ${d.color}1f` }
                      : { boxShadow: 'inset 0 0 0 2px #e2e4e8' }
                }
              >
                {done ? (
                  <Check className="h-[18px] w-[18px]" strokeWidth={2.75} />
                ) : isActive ? (
                  <span
                    className="h-2.5 w-2.5 animate-pulse rounded-full"
                    style={{ background: d.color }}
                  />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/25" />
                )}
              </button>

              {/* label */}
              <span
                className={cn(
                  'mt-2.5 max-w-[92px] text-center text-[11px] leading-tight',
                  done || isActive ? 'font-semibold' : 'font-medium',
                )}
                style={{ color: done ? d.color : isActive ? d.color : '#9aa0a6' }}
              >
                {d.label}
              </span>
              <span
                className={cn(
                  'mt-1 text-center text-[9px] font-medium uppercase tracking-wide',
                  isActive ? '' : 'text-muted-foreground/70',
                )}
                style={isActive ? { color: `${d.color}cc` } : undefined}
              >
                {done ? date : isActive ? 'Sırada' : 'Bekliyor'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PendingStepRow({ step }) {
  const labels = { goruldu: 'Tasarımcıya Aktarıldı', tasarimci_onay: 'Tasarımcı Onayı', matbaa_onay: 'Matbaa Teslimi', onaylandi: 'Üretime Alındı' }
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-3 opacity-60">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {labels[step] ?? step}
      </p>
      <div className="mt-2 flex min-h-[2.5rem] items-end border-b border-dashed border-foreground/15 pb-0.5" />
      <p className="mt-1 text-[10px] text-muted-foreground">Bekliyor…</p>
    </div>
  )
}

function MiniPipeline({ order, nextStep }) {
  const allSteps = ORDER_STEP_SEQUENCE
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
        {revizeCount > 0 ? `${revizeCount} görev revize edildi.` : 'İşaretlenen yok — her şey hazır.'}
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Printable "Sipariş Formu" — letterhead + Miktar/Cinsi table + signature footer.
// stepFilter: if provided, show only that step's signature layout; otherwise show final (onaylandi) layout.
function openOrderPrintWindow(order, stepFilter) {
  const items = normalizeItems(order.items, order.quantity)
  const created = order.created_at ? new Date(order.created_at) : new Date()
  const dateStr = created.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timeStr = created.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  const logoUrl = `${window.location.origin}/yz_blacklogo.svg`

  // Build signature cells based on which step we're printing
  const history = order.order_history ?? []
  const signerOf = (s) => history.find((h) => h.step === s)?.signed_by_name ?? ''
  const esra = order.requested_by_name ?? ''
  const gorulduSigner = signerOf('goruldu')
  const tasarimciSigner = signerOf('tasarimci_onay')
  const matbaaSigner = signerOf('matbaa_onay')
  const leaderSigner = signerOf('onaylandi') || gorulduSigner

  const activeStep = stepFilter ?? 'onaylandi'
  const sigCells = {
    pending:        [{ role: 'Sipariş Veren', name: esra }],
    goruldu:        [{ role: 'Ekip Lideri', name: gorulduSigner }, { role: 'Sipariş Veren', name: esra }],
    tasarimci_onay: [{ role: 'Ekip Lideri', name: gorulduSigner }, { role: 'Tasarımcı', name: tasarimciSigner }],
    matbaa_onay:    [{ role: 'Matbaa Yetkilisi', name: matbaaSigner }],
    onaylandi:      [{ role: 'Ekip Lideri', name: leaderSigner }, { role: 'Tasarımcı', name: tasarimciSigner }, { role: 'Matbaa Yetkilisi', name: matbaaSigner }],
  }[activeStep] ?? []

  const sigHtml = sigCells.map((c) =>
    `<div class="cell"><div class="cap">${escapeHtml(c.role)}</div><div class="name">${escapeHtml(c.name)}</div></div>`
  ).join('')

  const commonStyles = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#000;padding:18mm 20mm}
    .head{text-align:center;margin-bottom:14px}
    .head img{height:46px;width:auto;object-fit:contain}
    .head .co{font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.18em;color:#555;margin-top:4px}
    .doc-title{text-align:center;font-size:18pt;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin:10px 0 4px}
    .doc-sub{text-align:center;font-size:9pt;color:#555;margin-bottom:12px}
    .meta{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;font-size:10pt}
    .meta .label{color:#555;font-size:8.5pt}
    .meta .right{text-align:right;line-height:1.6}
    table{width:100%;border-collapse:collapse;border:1px solid #000}
    th,td{border:1px solid #000;padding:6px 8px}
    th{background:#f3f3f3;font-size:9pt;text-transform:uppercase;letter-spacing:.03em}
    td.qty{width:24%;text-align:center}
    td .sub{padding-left:14px;color:#444}
    td{height:26px}
    td.spec-label{width:42%;font-weight:700;font-size:9.5pt;text-transform:uppercase;letter-spacing:.02em;color:#333}
    .comp-header{background:#f3f4f6;font-weight:700;font-size:9pt;text-transform:uppercase;letter-spacing:.06em;text-align:center;padding:6px}
    .sig{display:flex;border:1px solid #000;border-top:0}
    .sig .cell{flex:1;border-right:1px solid #000;padding:8px 10px;min-height:70px}
    .sig .cell:last-child{border-right:0}
    .sig .cap{font-size:9pt;text-align:center;color:#333}
    .sig .name{font-family:'Alex Brush',cursive;font-size:20pt;color:#3d283499;text-align:center;margin-top:10px}
    @media print{body{padding:12mm 14mm}@page{size:A4;margin:0}}`

  let bodyContent
  const bookTitle = order.project_title?.replace(/ \/ /g, ' ') ?? ''

  if (activeStep === 'tasarimci_onay' || activeStep === 'matbaa_onay') {
    // Ozalit-style print: product specs + Esra's ordered ADET
    const comps = loadProductComps(order.project_id)
    const stepSubtitle = activeStep === 'tasarimci_onay' ? 'Tasarımcı → Matbaa' : 'Matbaa Teslimi'

    // Map component name → Esra's ordered quantity for print
    const printOrderItems = normalizeItems(order.items, order.quantity)
    const printQtyForComp = (compName) => {
      if (printOrderItems.length > 0) {
        const match = printOrderItems.find((it) => it.name?.toUpperCase() === compName?.toUpperCase())
        const qty = (match ?? printOrderItems[0])?.quantity
        return qty != null ? qty.toLocaleString('tr-TR') : null
      }
      return order.quantity != null ? order.quantity.toLocaleString('tr-TR') : null
    }

    const compSections = comps.length > 0
      ? comps.map((comp) => {
          const orderedQty = printQtyForComp(comp.component)
          const fields = (comp.fields ?? []).filter((f) => f.k?.toUpperCase() !== 'İŞİN ADI')
          const specRows = fields.map((f) => {
            const isAdet = f.k?.toUpperCase() === 'ADET'
            const val = isAdet && orderedQty != null ? orderedQty : (f.v ?? '')
            return `<tr><td class="spec-label">${escapeHtml(f.k)}</td><td>${escapeHtml(val)}</td></tr>`
          }).join('')
          return `<tr><td colspan="2" class="comp-header">${escapeHtml(comp.component)}</td></tr>${specRows}`
        }).join('')
      : order.quantity != null
        ? `<tr><td class="adet-label">ADET</td><td class="adet-val">${escapeHtml(order.quantity.toLocaleString('tr-TR'))}</td></tr>`
        : ''

    bodyContent = `
  <div class="doc-title">Ozalit Üretim Formu</div>
  <div class="doc-sub">${escapeHtml(stepSubtitle)}</div>
  <div class="meta">
    <div><div class="label">İşin Adı</div><strong>${escapeHtml(bookTitle)}</strong></div>
    <div class="right">
      <div><span class="label">Sipariş Tarihi :</span> ${escapeHtml(dateStr)}</div>
      <div><span class="label">Sipariş Veren :</span> ${escapeHtml(esra)}</div>
    </div>
  </div>
  <table><tbody>${compSections}</tbody></table>`
  } else {
    // Generic Sipariş Formu for pending / goruldu / onaylandi steps
    const hasSub = items.length > 0
    const totalQty = order.quantity ?? items.reduce((n, it) => Math.max(n, it.quantity || 0), 0)
    const MIN_ROWS = 16
    const rows = [
      { quantity: hasSub ? null : totalQty, name: bookTitle, sub: false },
      ...items.map((it) => ({ quantity: it.quantity, name: it.name, sub: true })),
    ]
    while (rows.length < MIN_ROWS) rows.push(null)
    const tableRowsHtml = rows.map((it) => {
      if (!it) return '<tr><td class="qty"></td><td class="cins"></td></tr>'
      const qty = it.quantity != null ? escapeHtml(it.quantity.toLocaleString('tr-TR')) : ''
      const name = it.sub
        ? `<span class="sub">– ${escapeHtml(it.name)}</span>`
        : `<strong>${escapeHtml(it.name)}</strong>`
      return `<tr><td class="qty">${qty}</td><td class="cins">${name}</td></tr>`
    }).join('')

    bodyContent = `
  <div class="doc-title">Sipariş Formu</div>
  <div class="meta">
    <div><div class="label">Sipariş Veren</div><strong>${escapeHtml(order.requested_by_name ?? '')}</strong></div>
    <div class="right">
      <div><span class="label">Sipariş Tarihi :</span> ${escapeHtml(dateStr)}</div>
      <div><span class="label">Sipariş Saati :</span> ${escapeHtml(timeStr)}</div>
    </div>
  </div>
  <table>
    <thead><tr><th class="qty">Miktar</th><th>Cinsi</th></tr></thead>
    <tbody>${tableRowsHtml}</tbody>
  </table>`
  }

  const html = `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"/>
  <link href="https://fonts.googleapis.com/css2?family=Alex+Brush&display=swap" rel="stylesheet"/>
  <title>Sipariş Formu — ${escapeHtml(order.project_title ?? '')}</title>
  <style>${commonStyles}</style></head><body>
  <div class="head">
    <img src="${logoUrl}" alt="Yükselen Zeka" width={120} height={36} loading="lazy" decoding="async"/>
    <div class="co">Yükselen Zeka Yayıncılık</div>
  </div>
  ${bodyContent}
  <div class="sig">${sigHtml}</div>
  </body></html>`

  const win = window.open('', '_blank', 'width=800,height=1000')
  if (!win) { toast.error('Pop-up engelleyiciyi kontrol edin.'); return }
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 350)
}

function pendingFutureSteps(order) {
  const allSteps = ['goruldu', 'tasarimci_onay', 'matbaa_onay', 'onaylandi']
  const done = new Set((order.order_history ?? []).map((h) => h.step))
  return allSteps.filter((s) => !done.has(s) && s !== order.status)
}

function stepShortLabel(step) {
  const map = {
    pending: 'Talep',
    goruldu: 'Aktarıldı',
    tasarimci_onay: 'Tasarımcı',
    matbaa_onay: 'Teslim',
    onaylandi: 'Onaylandı',
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
