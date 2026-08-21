import { useEffect, useState } from 'react'
import { Plus, Printer, ShoppingCart, X } from 'lucide-react'
import { toast } from 'sonner'

import api from '@/api'
import { getComponentsForProject, getComponentRows } from '@/data/productCatalog'
import { buildSpecRows, printSpecSheets } from '@/lib/specPrint'
import { useAuth } from '@/hooks/useAuth'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn, formatNumber } from '@/lib/utils'

const deepClone = (x) => JSON.parse(JSON.stringify(x ?? []))

/**
 * The order-side "Baskı Onay Formu" — the final print-spec gate
 * (`siparis_baski_onay`) a sipariş lands on once its ozalit round (physical
 * matbaa_onay OR digital ekran_onay) is fully approved. A team leader
 * corrects the per-parça specs and the ADET/tarih/basım yeri/hazırlayan
 * fields, then approves in one action — no maker-checker, no reject flow,
 * mirroring the main pipeline's baski_onay "edit instead of reject" rule.
 *
 * Deliberately NOT a SpecFormDialog variant: that component and its backing
 * `demos` table are project-scoped (`demos.project_id NOT NULL`, no
 * `order_id` column — two concurrent orders on the same project would
 * collide on the same row). This dialog is order-scoped from the ground up:
 * its snapshot lives in `order_requests.baski_onay_form` (migration 046),
 * saved/approved via PATCH/POST /order-requests/:id/baski-onay-form|approve.
 * It reuses the genuinely entity-agnostic pieces — specPrint.js's
 * buildSpecRows/printSpecSheets, and the product catalog readers.
 *
 * Props:
 *   order    – the full order object
 *   open     – boolean (ignored when `inline`)
 *   onOpenChange – (bool) => void (ignored when `inline`)
 *   onApproved   – (updatedOrder) => void, called after a successful approve
 *   mode     – 'approve' (default) or 'view' (read-only)
 *   inline   – when true, renders just the sheet content (no Dialog chrome),
 *              for embedding inside another dialog's own wrapper.
 */
export default function SiparisBaskiOnayFormDialog({
  order, open, onOpenChange, onApproved, mode = 'approve', inline = false,
}) {
  const { user } = useAuth()
  const [components, setComponents] = useState([])
  const [adet, setAdet] = useState('')
  const [tarih, setTarih] = useState('')
  const [basimYeri, setBasimYeri] = useState('')
  const [hazirlayan, setHazirlayan] = useState('')
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)

  const isReadOnly = mode === 'view' || user?.role !== 'team_leader' || order?.status !== 'siparis_baski_onay'
  const isOpen = inline || open

  useEffect(() => {
    if (!isOpen || !order) return
    const saved = order.baski_onay_form
    if (saved?.components?.length) {
      setComponents(deepClone(saved.components))
    } else {
      const catalog = getComponentsForProject(order.project_id).map((c) => ({
        id: c.component,
        component: c.component,
        rows: getComponentRows(c),
      }))
      setComponents(catalog)
    }
    setAdet(saved?.adet ?? defaultAdet(order))
    setTarih(saved?.tarih ?? new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }))
    setBasimYeri(saved?.basimYeri ?? '')
    setHazirlayan(saved?.hazirlayan ?? user?.name ?? '')
    // Deliberately keyed on order?.id, not order?.baski_onay_form — this
    // should seed local edit state once when the dialog opens for this
    // order, not reset in-progress edits on a background refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, order?.id])

  if (!order) return null

  function setRow(ci, ri, patch) {
    setComponents((prev) => prev.map((c, i) => (
      i !== ci ? c : { ...c, rows: c.rows.map((r, j) => (j === ri ? { ...r, ...patch } : r)) }
    )))
  }
  function addRow(ci) {
    setComponents((prev) => prev.map((c, i) => (
      i !== ci ? c : { ...c, rows: [...c.rows, { id: `row-${Date.now()}`, label: '', value: '' }] }
    )))
  }
  function removeRow(ci, ri) {
    setComponents((prev) => prev.map((c, i) => (
      i !== ci ? c : { ...c, rows: c.rows.filter((_, j) => j !== ri) }
    )))
  }

  function currentPayload() {
    return {
      components: components.map((c) => ({ component: c.component, rows: c.rows })),
      adet, tarih, basimYeri, hazirlayan,
    }
  }

  function handlePrint() {
    // No designer names available on the order object without an extra
    // fetch — the signature box just renders blank for "Tasarımcı" until
    // filled by hand, same as an unfilled signer anywhere else in the app.
    const designerNames = ''
    const form = { baskiOnayAdet: adet, baskiOnayTarihi: tarih, basimYeri, baskiOnayHazirlayan: hazirlayan }
    const bookTitle = order.project_title?.replace(/ \/ /g, ' ') ?? ''
    const list = components.length > 0 ? components : [{ component: bookTitle, rows: [] }]
    const sheets = list.map((c) => ({
      title: c.component || bookTitle,
      attemptLabel: 'BASKI ONAY',
      rows: buildSpecRows({ component: c, form, kind: 'baski_onay' }),
      designerNames,
      onaylayanKisi: hazirlayan,
    }))
    const ok = printSpecSheets(sheets, { docTitle: `Baskı Onay Formu — ${bookTitle}` })
    if (!ok) toast.error('Pop-up engelleyiciyi kontrol edin.')
  }

  async function handleSave() {
    setSaving(true)
    try {
      const updated = await api.saveOrderBaskiOnayForm(order.id, currentPayload())
      toast.success('Baskı onay formu kaydedildi.')
      onApproved?.(updated)
    } catch (err) {
      toast.error(err.message || 'Kaydetme başarısız.')
    } finally {
      setSaving(false)
    }
  }

  async function handleApprove() {
    if (!adet.trim() || !tarih.trim() || !hazirlayan.trim()) {
      toast.error('Adet, tarih ve hazırlayan alanları zorunludur.')
      return
    }
    setApproving(true)
    try {
      const updated = await api.approveOrderBaskiOnayForm(order.id, currentPayload())
      toast.success('Baskı onaylandı, üretime alındı.')
      onOpenChange?.(false)
      onApproved?.(updated)
    } catch (err) {
      toast.error(err.message || 'Onaylama başarısız.')
    } finally {
      setApproving(false)
    }
  }

  const bookTitle = order.project_title?.replace(/ \/ /g, ' ') ?? ''
  const busy = saving || approving

  const body = (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
        <div className="flex items-start gap-2">
          <ShoppingCart className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm font-semibold leading-snug">{bookTitle}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="baski-onay-adet">Adet *</Label>
          <Input id="baski-onay-adet" value={adet} onChange={(e) => setAdet(e.target.value)} readOnly={isReadOnly} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="baski-onay-tarih">Tarih *</Label>
          <Input id="baski-onay-tarih" value={tarih} onChange={(e) => setTarih(e.target.value)} readOnly={isReadOnly} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="baski-onay-yer">Basım Yeri</Label>
          <Input id="baski-onay-yer" value={basimYeri} onChange={(e) => setBasimYeri(e.target.value)} readOnly={isReadOnly} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="baski-onay-hazirlayan">Hazırlayan *</Label>
          <Input id="baski-onay-hazirlayan" value={hazirlayan} onChange={(e) => setHazirlayan(e.target.value)} readOnly={isReadOnly} />
        </div>
      </div>

      <div className="space-y-2">
        {components.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">Bu ürün için bilgi yok.</p>
        ) : (
          components.map((c, ci) => (
            <div key={c.id ?? c.component} className="overflow-hidden rounded-lg border bg-white">
              <div className="border-b bg-muted/30 px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-widest text-foreground">
                {c.component}
              </div>
              <div className="px-2 py-1">
                {c.rows.map((r, ri) => (
                  <div key={r.id ?? ri} className="flex items-center gap-1.5 border-b py-1 last:border-b-0">
                    <input
                      value={r.label}
                      onChange={(e) => setRow(ci, ri, { label: e.target.value })}
                      placeholder="ALAN"
                      readOnly={isReadOnly}
                      className="w-24 shrink-0 bg-transparent text-[11px] font-semibold uppercase tracking-wide outline-none placeholder:text-muted-foreground/50"
                    />
                    <span className="text-xs font-bold text-muted-foreground">:</span>
                    <input
                      value={r.value}
                      onChange={(e) => setRow(ci, ri, { value: e.target.value })}
                      placeholder="Değer"
                      readOnly={isReadOnly}
                      className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/50"
                    />
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={() => removeRow(ci, ri)}
                        aria-label="Satırı sil"
                        className="shrink-0 rounded p-0.5 text-muted-foreground transition active:scale-90 hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={() => addRow(ci)}
                    className="mt-1 inline-flex items-center gap-1 px-1 py-1 text-[11px] font-semibold text-primary transition active:scale-95 hover:opacity-80"
                  >
                    <Plus className="h-3 w-3" /> Satır Ekleyin
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )

  const footer = (
    <div className={cn('flex flex-wrap gap-2', inline ? 'justify-end' : 'sm:justify-between')}>
      <Button type="button" variant="outline" onClick={handlePrint} disabled={busy}>
        <Printer className="h-4 w-4" />
        Yazdırın
      </Button>
      {!isReadOnly && (
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={handleSave} disabled={busy}>
            {saving ? 'Kaydediliyor…' : 'Kaydedin'}
          </Button>
          <Button type="button" onClick={handleApprove} disabled={busy}>
            {approving ? 'Onaylanıyor…' : 'Onaylayın'}
          </Button>
        </div>
      )}
    </div>
  )

  if (inline) {
    return (
      <div className="space-y-4">
        {body}
        {footer}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange?.(v)}>
      <DialogContent className={cn('max-w-lg', DIALOG_MOBILE_SHEET)}>
        <DialogHeader>
          <DialogTitle>Baskı Onay Formu</DialogTitle>
          <DialogDescription>
            {isReadOnly
              ? 'Bu adımda kaydedilen form.'
              : 'Adet ve diğer alanları kontrol edin, gerekirse düzeltin, ardından onaylayın.'}
          </DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter className="gap-2">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function defaultAdet(order) {
  const items = Array.isArray(order.items) ? order.items : []
  if (items.length > 1) {
    return items.map((it) => `${it.name}: ${formatNumber(it.quantity)}`).join(', ')
  }
  return order.quantity != null ? formatNumber(order.quantity) : ''
}
