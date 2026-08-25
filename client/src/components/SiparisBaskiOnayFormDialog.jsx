import { useEffect, useState } from 'react'
import { Plus, Printer, ShoppingCart, X } from 'lucide-react'
import { toast } from 'sonner'

import api from '@/api'
import { getComponentsForProject, getComponentRows } from '@/data/productCatalog'
import { buildBaskiOnayForm, printSpecSheets } from '@/lib/specPrint'
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
 * buildBaskiOnayForm/printSpecSheets, and the product catalog readers.
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

  function currentPayload() {
    return {
      components: components.map((c) => ({ component: c.component, rows: c.rows })),
      adet, tarih, basimYeri, hazirlayan,
    }
  }

  /**
   * One boxed Baskı Onay Formu per parça, all in a single print job — this
   * is the sheet the matbaa prints from and signs, so it comes out as an
   * actual form (künye grid + spec table + signature strip), not as the
   * classic flat label:value list demo/ozalit use.
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
    const sheets = list.map((c) => buildBaskiOnayForm({ component: c, form, title: bookTitle }))
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

  /* The dialog IS the form: one white sheet — title block, künye, then a
     block per parça — so what the leader edits on screen reads as the same
     document handlePrint() puts on paper, instead of a stack of loose
     inputs. Editable and read-only render the same layout; only the fields
     switch between input and plain text. */
  const body = (
    <div className="overflow-hidden rounded-lg border bg-white">
      <div className="border-b px-4 py-3 text-center">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.18em] text-foreground">Baskı Onay Formu</h2>
        <p className="mt-1.5 flex items-start justify-center gap-1.5 text-[13px] font-semibold leading-snug text-foreground">
          <ShoppingCart className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-words">{bookTitle}</span>
        </p>
      </div>

      {/* Künye — the four fields the matbaa actually prints from. */}
      <div className="border-b bg-muted/10 px-4 py-0.5">
        <FormRow label="ADET" name="baski-onay-adet" value={adet} onChange={setAdet} readOnly={isReadOnly} required />
        <FormRow label="TARİH" name="baski-onay-tarih" value={tarih} onChange={setTarih} readOnly={isReadOnly} required />
        <FormRow label="BASIM YERİ" name="baski-onay-yer" value={basimYeri} onChange={setBasimYeri} readOnly={isReadOnly} required />
        <FormRow label="HAZIRLAYAN" name="baski-onay-hazirlayan" value={hazirlayan} onChange={setHazirlayan} readOnly={isReadOnly} required />
        {/* Only once the approve actually stamped it — an unapproved sheet
            must not read as already signed. */}
        {onaylayan && <FormRow label="ONAYLAYAN" value={onaylayan} readOnly />}
      </div>

      {/* One block per parça — each of these prints as its own sheet. */}
      {components.length === 0 ? (
        <p className="px-4 py-4 text-center text-xs text-muted-foreground">Bu ürün için bilgi yok.</p>
      ) : (
        components.map((c, ci) => (
          <div key={c.id ?? c.component} className="border-b last:border-b-0">
            <div className="border-b bg-muted/30 px-4 py-1.5 text-center text-[11px] font-bold uppercase tracking-widest text-foreground">
              {c.component}
            </div>
            <div className="px-4 py-0.5">
              {c.rows.map((r, ri) => (
                <div key={r.id ?? ri} className={ROW_GRID}>
                  {/* The label is editable (a leader may rename a spec field),
                      so it is an input while editing and a plain span once the
                      sheet is read-only — where it then matches the künye
                      labels exactly. */}
                  {isReadOnly ? (
                    <span className={LABEL_CLS}>{r.label}</span>
                  ) : (
                    <input
                      value={r.label}
                      onChange={(e) => setRow(ci, ri, { label: e.target.value })}
                      placeholder="ALAN"
                      className={cn(LABEL_CLS, 'min-w-0 bg-transparent outline-none placeholder:text-muted-foreground/50')}
                    />
                  )}
                  <span className={COLON_CLS}>:</span>
                  <div className={cn(VALUE_CELL_CLS, 'relative')}>
                    {isReadOnly ? (
                      <span className={VALUE_TEXT_CLS}>{r.value || '—'}</span>
                    ) : (
                      <input
                        value={r.value}
                        onChange={(e) => setRow(ci, ri, { value: e.target.value })}
                        placeholder="Değer"
                        className="h-8 w-full min-w-0 bg-transparent pr-6 text-[13px] outline-none placeholder:text-muted-foreground/50"
                      />
                    )}
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={() => removeRow(ci, ri)}
                        aria-label="Satırı sil"
                        className="absolute right-0 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition active:scale-90 hover:text-destructive print:hidden"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={() => addRow(ci)}
                  className="my-1 inline-flex items-center gap-1 py-1 text-[11px] font-semibold text-primary transition active:scale-95 hover:opacity-80 print:hidden"
                >
                  <Plus className="h-3 w-3" /> Satır Ekleyin
                </button>
              )}
            </div>
          </div>
        ))
      )}
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

/* The künye rows and the parça rows share one grid, so every colon on the
   sheet lines up and the value column reads as a real column with a rule down
   it — that grid is what makes this look like a form rather than a list. The
   label column is wide enough for HAZIRLAYAN / BASIM YERİ at 390px and wraps
   rather than truncating. */
const ROW_GRID = 'grid grid-cols-[minmax(5.5rem,36%)_auto_1fr] items-center border-b last:border-b-0'
const LABEL_CLS = 'py-1.5 pr-2 text-[11px] font-semibold uppercase leading-snug tracking-wide text-muted-foreground'
const COLON_CLS = 'self-stretch pt-1.5 text-center text-xs font-bold text-muted-foreground'
const VALUE_CELL_CLS = 'min-w-0 self-stretch border-l pl-2'
const VALUE_TEXT_CLS = 'block whitespace-pre-wrap break-words py-1.5 text-[13px] leading-snug text-foreground'

/* One künye line (LABEL : value) — the same shape as a parça row, and as the
   printed form's künye grid. Read-only renders plain text instead of a dead
   input, so a sheet that can no longer be edited reads as a document. */
function FormRow({ label, name, value, onChange, readOnly, required = false }) {
  const missing = required && !String(value ?? '').trim()
  return (
    <div className={ROW_GRID}>
      <span className={LABEL_CLS}>
        {label}
        {/* The asterisk is a fill-this-in instruction — nothing to obey on a
            sheet that can no longer be edited, or on paper. */}
        {required && !readOnly && <span className="text-destructive print:hidden"> *</span>}
      </span>
      <span className={COLON_CLS}>:</span>
      <div className={cn(VALUE_CELL_CLS, missing && !readOnly && 'bg-destructive/5')}>
        {readOnly ? (
          <span className={VALUE_TEXT_CLS}>{value || '—'}</span>
        ) : (
          <Input
            name={name}
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder={missing ? 'Zorunlu' : undefined}
            className={cn(
              'h-8 min-w-0 rounded-none border-0 bg-transparent px-0 py-1 text-[13px] shadow-none focus-visible:ring-0',
              missing && 'placeholder:text-destructive/60',
            )}
          />
        )}
      </div>
    </div>
  )
}

function defaultAdet(order) {
  const items = Array.isArray(order.items) ? order.items : []
  if (items.length > 1) {
    return items.map((it) => `${it.name}: ${formatNumber(it.quantity)}`).join(', ')
  }
  return order.quantity != null ? formatNumber(order.quantity) : ''
}
