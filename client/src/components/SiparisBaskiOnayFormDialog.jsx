import { useEffect, useState } from 'react'
import { Pencil, Printer, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'

import api from '@/api'
import { getComponentsForProject, getComponentRows } from '@/data/productCatalog'
import { missingTemplateLabels, parcaKind } from '@/data/parcaTemplates'
import { adetForComponent, isAdetLabel, missingAdetLabel, withAdetRow } from '@/lib/spec-form-adet'
import { buildFormSheet, printSpecSheets } from '@/lib/specPrint'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import {
  FormSheet,
  FormSheetBlock,
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
import { cn } from '@/lib/utils'

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
  const [tarih, setTarih] = useState('')
  const [basimYeri, setBasimYeri] = useState('')
  const [hazirlayan, setHazirlayan] = useState('')
  // Stamped by POST .../baski-onay-approve, so it stays blank on a sheet
  // that hasn't been approved yet — the form prints an empty signature
  // line there rather than pre-filling the approver.
  const [onaylayan, setOnaylayan] = useState('')
  const [saving, setSaving] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [approving, setApproving] = useState(false)
  // Approver-side edit override (same pattern as BaskiOnayFormDialog /
  // SpecFormDialog's baskiOnayEditOverride). Defaults OFF so the form opens
  // locked once prepared; the approver clicks "Düzenleyin" in the footer to
  // unlock if a field really needs a fix before signing. Reset on every
  // (re)open so a stale unlock from a previous order never carries over.
  const [baskiOnayEditOverride, setBaskiOnayEditOverride] = useState(false)

  /* ── Sipariş Baskı Onayı maker-checker (migration 060) ─────────────────────
   * Brought in line with the project-side gate (migration 045): one team
   * leader PREPARES the sheet, a DIFFERENT one gives the actual approval.
   * The server is the source of truth for "different person" — it counts the
   * ACTIVE leaders and lets a lone one self-approve rather than strand the
   * order — so this dialog only picks which button to show, and lets the
   * server's Turkish error surface via toast on a blocked click. */
  const baskiOnayPrepared = !!order?.baski_onay_prepared
  const preparedByName = order?.baski_onay_prepared_by_name

  // Approver-step read-only lock (same shape as BaskiOnayFormDialog's
  // baskiOnayLocked in SpecFormDialog): once the form has been prepared,
  // the approver is signing what was prepared, not authoring — so the form
  // defaults to read-only with an opt-in "Düzenleyin" override.
  const isApproverStep =
    mode === 'approve'
    && user?.role === 'team_leader'
    && order?.status === 'siparis_baski_onay'
  const baskiOnayLocked =
    isApproverStep && baskiOnayPrepared && !baskiOnayEditOverride

  const isReadOnly =
    mode === 'view'
    || user?.role !== 'team_leader'
    || order?.status !== 'siparis_baski_onay'
    || baskiOnayLocked
  const isOpen = inline || open

  useEffect(() => {
    if (!isOpen || !order) return
    // Every reopen: clear the edit override so a previous unlock doesn't
    // bleed into a different order's approve view.
    setBaskiOnayEditOverride(false)
    const saved = order.baski_onay_form
    // ADET, per parça, straight off the order the sales team raised — this
    // side never has to guess. `withAdetRow` puts it under the parça's SAYFA
    // SAYISI and leaves a filled row alone, so a leader's correction survives
    // a reopen; `saved.adet` is what a sheet approved before ADET moved off
    // the künye carries, lifted onto the rows so it still reads back.
    const withAdet = (c) => ({ ...c, rows: withAdetRow(c.rows, adetForComponent(c.component, order) || (saved?.adet ?? '')) })
    if (saved?.components?.length) {
      setComponents(deepClone(saved.components).map(withAdet))
    } else {
      const catalog = getComponentsForProject(order.project_id).map((c) => ({
        id: c.component,
        component: c.component,
        rows: getComponentRows(c),
      }))
      // A sipariş cannot be raised without ürün bilgileri (pipeline.js
      // #assertOrderable), but this dialog reads the catalog out of a
      // synchronous local cache that may simply not be primed yet. It used to
      // render "Bu ürün için bilgi yok." and nothing else — and now that ADET
      // lives on the blocks, a sheet with no block would have nowhere to carry
      // the quantity and could never be approved. One block named after the
      // product, exactly as the project side falls back to its custom rows.
      const blocks = catalog.length > 0
        ? catalog
        : [{ id: order.project_title ?? order.id, component: (order.project_title ?? '').replace(/ \/ /g, ' '), rows: [] }]
      setComponents(blocks.map(withAdet))
    }
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
  // `label` pre-names the row so a deleted template line goes back with a tap
  // (the chips on SheetAddRow) instead of being retyped.
  function addRow(ci, label = '') {
    setComponents((prev) => prev.map((c, i) => (
      i !== ci ? c : { ...c, rows: [...c.rows, { id: `row-${Date.now()}`, label, value: '' }] }
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
      tarih, basimYeri, hazirlayan,
    }
  }

  /**
   * One Baskı Onay Formu per parça, all in a single print job.
   */
  function handlePrint() {
    if (!isReadOnly && !requiredFilled()) return
    const form = {
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
      missingAdetLabel(components),
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

  /**
   * Maker half: saves the sheet and stamps it "hazırlandı". Does NOT advance
   * the order — it stays at siparis_baski_onay until a leader approves.
   */
  async function handlePrepare() {
    if (!requiredFilled()) return
    setPreparing(true)
    try {
      const updated = await api.prepareOrderBaskiOnayForm(order.id, currentPayload())
      toast.success('Baskı onay formu hazırlandı, ekip lideri onayı bekleniyor.')
      onOpenChange?.(false)
      onApproved?.(updated)
    } catch (err) {
      toast.error(err.message || 'Hazırlama başarısız.')
    } finally {
      setPreparing(false)
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
  const busy = saving || preparing || approving

  /* The dialog IS the form: the same document handlePrint() puts on paper,
     rendered live. Editable and read-only share one layout; only the fields
     switch between input and plain text. */
  const body = (
    <FormSheet>
      <FormSheetHead title="Baskı Onay Formu" subtitle={bookTitle} icon={ShoppingCart} />

      {/* One block per parça — each of these prints as its own sheet. A
          product whose catalog hasn't loaded still gets one block (see the
          load effect), so this empty state is the no-order case only. */}
      {components.length === 0 ? (
        <p className="px-4 py-4 text-center text-xs text-muted-foreground">Bu ürün için bilgi yok.</p>
      ) : (
        components.map((c, ci) => (
          <div key={c.id ?? c.component} className="border-b last:border-b-0">
            <FormSheetBlock className="border-b-0">
              {/* Named by its own İŞİN ADI row, the way it prints and the way
                  the project-side sheet does it (SpecSheetBody). Read-only:
                  the parça's name is its identity, edited in Ürün Bilgileri.
                  Tinted, and marked "PARÇA n/N", so blocks scrolling as one
                  document still read as the separate sheets they print as. */}
              <SheetRow
                label="İŞİN ADI"
                value={c.component}
                readOnly
                className="bg-muted/40 font-semibold print:bg-transparent print:font-normal"
                badge={components.length > 1 ? (
                  <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ring-1 ring-border">
                    Parça {ci + 1}/{components.length}
                  </span>
                ) : null}
              />
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
                  required={isAdetLabel(r.label)}
                />
              ))}
              {!isReadOnly && (
                <SheetAddRow
                  onClick={() => addRow(ci)}
                  suggestions={missingTemplateLabels(parcaKind(c), c.rows)}
                  onAddSuggestion={(label) => addRow(ci, label)}
                />
              )}
            </FormSheetBlock>
          </div>
        ))
      )}

      {/* Künye — the four fields the matbaa actually prints from, plus the
          approval stamp. The form's foot, exactly where handlePrint() puts it
          on paper (specPrint.js): the parça spec is what the sheet is FOR, and
          the rows the form fills in about itself close it. */}
      <FormSheetBlock className="bg-muted/10">
        {/* No ADET here — it is a row inside each parça block above, under that
            parça's SAYFA SAYISI, so an order for 5.000 books in 2.500 boxes
            prints the right number on each sheet instead of one string reading
            "Kitap: 5.000, Kutu: 2.500". See lib/spec-form-adet.js. */}
        <SheetRow label="TARİH" name="tarih" value={tarih} onChange={(e) => setTarih(e.target.value)} readOnly={isReadOnly} required />
        <SheetRow label="BASIM YERİ" name="basimYeri" value={basimYeri} onChange={(e) => setBasimYeri(e.target.value)} readOnly={isReadOnly} required />
        <SheetRow label="HAZIRLAYAN" name="hazirlayan" value={hazirlayan} onChange={(e) => setHazirlayan(e.target.value)} readOnly={isReadOnly} required />
        {/* Only once the approve actually stamped it — an unapproved sheet
            must not read as already signed. */}
        {onaylayan && <SheetRow label="ONAYLAYAN" value={onaylayan} readOnly />}
      </FormSheetBlock>
    </FormSheet>
  )

  const footer = (
    <div className={cn('flex flex-wrap gap-2', inline ? 'justify-end' : 'sm:justify-between')}>
      <Button type="button" variant="outline" onClick={handlePrint} disabled={busy}>
        <Printer className="h-4 w-4" />
        Yazdırın
      </Button>
      {isApproverStep && (
        <div className="flex gap-2">
          {/* "Onaylamadan Kaydedin" — only while preparing (not yet
              baskiOnayPrepared). Once prepared, every edit rides through
              Approve via the current payload, so a separate Save no longer
              makes sense. The override button below is how the approver
              parks changes before signing. */}
          {!isReadOnly && !baskiOnayPrepared && (
            <Button type="button" variant="ghost" onClick={handleSave} disabled={busy}>
              {saving ? 'Kaydediliyor…' : 'Onaylamadan Kaydedin'}
            </Button>
          )}
          {/* Approver-step edit override — same shape as BaskiOnayFormDialog's
              SpecFormFooter toggle. The approver signs what was prepared,
              so the form is locked by default; they click Düzenleyin if a
              field really needs a fix before signing. */}
          {baskiOnayPrepared && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setBaskiOnayEditOverride((v) => !v)}
              disabled={busy}
            >
              <Pencil className="h-4 w-4" />
              {baskiOnayEditOverride ? 'Kilitleyin' : 'Düzenleyin'}
            </Button>
          )}
          {/* Prepare / Approve half. Lives OUTSIDE the !isReadOnly check on
              purpose: the approve button must stay clickable while the
              form is locked, so the approver can sign what was prepared. */}
          {baskiOnayPrepared ? (
            <Button type="button" onClick={handleApprove} disabled={busy}>
              {approving ? 'Onaylanıyor…' : 'Onaylayın'}
            </Button>
          ) : (
            <Button type="button" onClick={handlePrepare} disabled={busy}>
              {preparing ? 'Hazırlanıyor…' : 'Baskı Onayı Hazırlayın'}
            </Button>
          )}
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
        {/* Titled again by the sheet itself — see SpecFormDialog. */}
        <DialogHeader className="print:hidden">
          <DialogTitle>Baskı Onay Formu</DialogTitle>
          <DialogDescription>
            {isReadOnly
              ? 'Bu adımda kaydedilen form.'
              : baskiOnayPrepared
                ? `${preparedByName ?? 'Bir ekip lideri'} formu hazırladı. Form kilitlidir — yalnızca onaylayabilirsiniz. Bir alanı düzeltmeniz gerekirse sağ alttaki "Düzenleyin" ile geçici olarak açabilirsiniz.`
                : 'Adet ve diğer alanları kontrol edin, gerekirse düzeltin, ardından onaya gönderin.'}
          </DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter className="gap-2">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
   

