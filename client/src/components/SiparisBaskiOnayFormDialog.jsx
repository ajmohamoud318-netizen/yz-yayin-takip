import { useEffect, useState } from 'react'
import { Printer, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'

import api from '@/api'
import { getComponentsForProject, getComponentRows } from '@/data/productCatalog'
import { buildFormSheet, printSpecSheets } from '@/lib/specPrint'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import {
  FormSheet,
  FormSheetBlock,
  FormSheetBlockTitle,
  FormSheetHead,
  SheetAddRow,
  SheetRow,
  SheetSpecRow,
} from '@/components/FormSheet'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DIALOG_MOBILE_SHEET,
} from '@/components/ui/dialog'
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
 * buildFormSheet/printSpecSheets, and the product catalog readers.
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
  // Stamped by POST .../baski-onay-approve, so it stays blank on a sheet
  // that hasn't been approved yet — the form prints an empty signature
  // line there rather than pre-filling the approver.
  const [onaylayan, setOnaylayan] = useState('')
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
    setOnaylayan(saved?.approved_by_name ?? '')
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
  // Row order is the order the parça prints in, so it is worth being able to
  // fix without deleting and retyping the row.
  function moveRow(ci, ri, dir) {
    setComponents((prev) => prev.map((c, i) => {
      if (i !== ci) return c
      const to = ri + dir
      if (to < 0 || to >= c.rows.length) return c
      const rows = [...c.rows]
      const [row] = rows.splice(ri, 1)
      rows.splice(to, 0, row)
      return { ...c, rows }
    }))
  }

  function currentPayload() {
    return {
      components: components.map((c) => ({ component: c.component, rows: c.rows })),
      adet, tarih, basimYeri, hazirlayan,
    }
  }

  /**
   * One Baskı Onay Formu per parça, all in a single print job.
   */
  function handlePrint() {
    if (!isReadOnly && !requiredFilled()) return
    const form = {
      baskiOnayAdet: adet,
      baskiOnayTarihi: tarih,
      basimYeri,
      baskiOnayHazirlayan: hazirlayan,
      onaylayanKisi: onaylayan,
    }
    const bookTitle = order.project_title?.replace(/ \/ /g, ' ') ?? ''
    const list = components.length > 0 ? components : [{ component: bookTitle, rows: [] }]
    const sheets = list.map((c) => buildFormSheet({ component: c, form, kind: 'baski_onay', title: bookTitle }))
    const ok = printSpecSheets(sheets, { docTitle: `Baskı Onay Formu — ${bookTitle}` })
    if (!ok) toast.error('Pop-up engelleyiciyi kontrol edin.')
  }

  /**
   * ADET and BASIM YERİ are what the matbaa physically prints from, so this
   * sheet may never be stored with either blank — not even as a parked draft,
   * which is exactly what the next reader picks up and approves. Mirrors the
   * same rule on the project-side Baskı Onay Formu (SpecFormDialog).
   */
  function missingRequired() {
    return [
      !adet.trim() && 'ADET',
      !tarih.trim() && 'TARİH',
      !basimYeri.trim() && 'BASIM YERİ',
      !hazirlayan.trim() && 'HAZIRLAYAN',
    ].filter(Boolean)
  }

  function requiredFilled() {
    const missing = missingRequired()
    if (missing.length === 0) return true
    toast.error(`${missing.join(', ')} boş bırakılamaz.`)
    return false
  }

  async function handleSave() {
    if (!requiredFilled()) return
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
    if (!requiredFilled()) return
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

  /* The dialog IS the form: the same document handlePrint() puts on paper,
     rendered live. Editable and read-only share one layout; only the fields
     switch between input and plain text. */
  const body = (
    <FormSheet>
      <FormSheetHead title="Baskı Onay Formu" subtitle={bookTitle} icon={ShoppingCart} />

      {/* Künye — the four fields the matbaa actually prints from. */}
      <FormSheetBlock className="bg-muted/10">
        <SheetRow label="ADET" name="adet" value={adet} onChange={(e) => setAdet(e.target.value)} readOnly={isReadOnly} required />
        <SheetRow label="TARİH" name="tarih" value={tarih} onChange={(e) => setTarih(e.target.value)} readOnly={isReadOnly} required />
        <SheetRow label="BASIM YERİ" name="basimYeri" value={basimYeri} onChange={(e) => setBasimYeri(e.target.value)} readOnly={isReadOnly} required />
        <SheetRow label="HAZIRLAYAN" name="hazirlayan" value={hazirlayan} onChange={(e) => setHazirlayan(e.target.value)} readOnly={isReadOnly} required />
        {/* Only once the approve actually stamped it — an unapproved sheet
            must not read as already signed. */}
        {onaylayan && <SheetRow label="ONAYLAYAN" value={onaylayan} readOnly />}
      </FormSheetBlock>

      {/* One block per parça — each of these prints as its own sheet. */}
      {components.length === 0 ? (
        <p className="px-4 py-4 text-center text-xs text-muted-foreground">Bu ürün için bilgi yok.</p>
      ) : (
        components.map((c, ci) => (
          <div key={c.id ?? c.component} className="border-b last:border-b-0">
            <FormSheetBlockTitle>{c.component}</FormSheetBlockTitle>
            <FormSheetBlock className="border-b-0">
              {c.rows.map((r, ri) => (
                <SheetSpecRow
                  key={r.id ?? ri}
                  label={r.label}
                  value={r.value}
                  onLabelChange={(v) => setRow(ci, ri, { label: v })}
                  onValueChange={(v) => setRow(ci, ri, { value: v })}
                  onRemove={() => removeRow(ci, ri)}
                  onMoveUp={c.rows.length > 1 && ri > 0 ? () => moveRow(ci, ri, -1) : null}
                  onMoveDown={c.rows.length > 1 && ri < c.rows.length - 1 ? () => moveRow(ci, ri, 1) : null}
                  readOnly={isReadOnly}
                />
              ))}
              {!isReadOnly && <SheetAddRow onClick={() => addRow(ci)} />}
            </FormSheetBlock>
          </div>
        ))
      )}
    </FormSheet>
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
