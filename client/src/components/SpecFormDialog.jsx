import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, CheckCircle2, CheckSquare, FileText, Minus, Pencil, Plus, Printer, Send, Square } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DIALOG_MOBILE_SHEET,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import api from '@/api'
import {
  FormSheet,
  FormSheetBlock,
  FormSheetBlockTitle,
  FormSheetHead,
  SheetAddRow,
  SheetRow,
  SheetSpecRow,
} from '@/components/FormSheet'
import { useAuth } from '@/hooks/useAuth'
import { useProjectsStore } from '@/hooks/useProjectsStore'
import { useDesignerCelebration } from '@/hooks/useCelebration'
import { getComponentsForProject, getComponentRows, primeProductInfoCache, saveEditedComponents } from '@/data/productCatalog'
import { printSpecSheets, buildFormSheet } from '@/lib/specPrint'
import { hasSpecContent, specWithDemoFallback } from '@/lib/spec-seed'
import { buildAdetRows, buildOrderAdetRows, loadOrderAdet } from '@/data/orderAdet'
import { formatNumber } from '@/lib/utils'
import { ozalitLeaderApproved } from '@/domain'

/* ------------------------------------------------------------------ */
/*  Variant configuration — everything that differs between the Demo  */
/*  and Ozalit spec sheets lives here. The component below is shared. */
/* ------------------------------------------------------------------ */

// Yazdır is only available to the designer once the demo has been submitted —
// i.e. while composing (mode === 'advance') the button is hidden, and other
// roles never see it. Stages after Tasarım mark "demo already submitted".
const POST_DEMO_STAGES = new Set([
  'demo_teslim', 'cin_demo_teslim',
  'demo_onay',   'cin_demo_onay',
  'ozalit_teslim','ozalit_onay',
  'baski_onay', 'cin_baski_onay',
  'baskida','gumruk','satista',
])

export const VARIANTS = {
  demo: {
    kind: 'demo',
    storagePrefix: 'yz_demo_form_',
    dateField:   'demoIstemTarihi',
    personField: 'demoIsteyenKisi',
    dateLabel:   'DEMO İSTEM TARİHİ',
    personLabel: 'DEMO İSTEYEN KİŞİ',
    attemptField: 'demo_attempt',
    title: 'Demo Üretim Formu',
    attemptWord: 'Demo',
    attemptUpper: 'DEMO',
    // İŞİN ADI is always the project title — designers can override the value
    // with custom rows but cannot edit the title field. System-driven fields
    // (dates / requester) are likewise never editable by the designer.
    systemFieldsEditable: false,
    // Active editing starts from fresh, keeping only the printer-signed field
    // (matbaaYetkilisi); the system-driven fields auto-recompute.
    restoreSavedOnEdit: false,
    celebrateOnAdvance: true,
    // Kaydet in 'view' mode is not additionally gated on readOnly.
    saveRequiresEditable: false,
    // Matbaa (printer) may view, sign, and forward the demo but must never
    // alter the spec the designer/leader prepared — lock every field for them.
    // History snapshots are read-only for everyone.
    isReadOnly: ({ mode, user }) => mode === 'history' || user?.role === 'printer',
    canPrint: ({ user, project }) =>
      user?.role === 'designer' && !!project?.stage && POST_DEMO_STAGES.has(project.stage),
    advanceToast: (project) =>
      project.type === 'CIN' ? 'Demo gönderildi.' : 'Demo matbaaya gönderildi.',
    advanceLabel: (user) => (user?.role === 'printer' ? "Demo'yu Teslim Edin" : 'Demo İsteyin'),
    saveToast: 'Demo formu kaydedildi.',
  },
  ozalit: {
    kind: 'ozalit',
    storagePrefix: 'yz_ozalit_form_',
    dateField:   'ozalitIstemTarihi',
    personField: 'ozalitIsteyenKisi',
    dateLabel:   'OZALİT İSTEM TARİHİ',
    personLabel: 'OZALİT İSTEYEN KİŞİ',
    attemptField: 'ozalit_attempt',
    title: 'Ozalit Üretim Formu',
    attemptWord: 'Ozalit',
    attemptUpper: 'OZALİT',
    // The team leader authors the ozalit spec, so title/date fields follow the
    // dialog's readOnly state instead of being permanently locked.
    systemFieldsEditable: true,
    restoreSavedOnEdit: true,
    celebrateOnAdvance: false,
    saveRequiresEditable: true,
    // Only the team leader authors the ozalit spec. Everyone else views it:
    //   • the matbaa (printer) receives, signs, and forwards it — never edits;
    //   • the designer can open it (e.g. from Baskı Onayı) but must not
    //     change the spec — they only see and print it.
    // History snapshots are read-only for everyone.
    isReadOnly: ({ mode, user }) =>
      mode === 'history' || user?.role === 'printer' || user?.role === 'designer',
    canPrint: () => true,
    advanceToast: () => 'Ozalit onaya gönderildi.',
    advanceLabel: (user) => (user?.role === 'printer' ? 'Ozaliti Teslim Edin' : 'Matbaaya Gönderin'),
    saveToast: 'Ozalit formu kaydedildi.',
  },
  // Baskı Onay Formu — the final print approval at the `baski_onay` gate
  // between ozalit_onay and baskida (TR), reused as-is for ÇİN's mirror gate
  // `cin_baski_onay` between cin_demo_onay and baskida (migration 047) — see
  // STAGE_VARIANT below, which maps both stage names to this one variant.
  // Comes to screen pre-filled with the last ozalit sheet's information for
  // TR, or the last demo sheet's for ÇİN (see the fallback block in the load
  // effect below) and may only be edited by a team_leader ("Serpil Hanım",
  // Ayşenur, …) — every other role sees it read-only. Approval is
  // dual-signature (migration 045): one team leader prepares it (handled
  // below via handlePrepareBaskiOnay), a DIFFERENT team leader approves it
  // (handleApprove) — see the isBaskiOnayApproval block further down. There
  // is no advance mode: the form is auto-created on entering the stage,
  // never requested.
  baski_onay: {
    kind: 'baski_onay',
    storagePrefix: 'yz_baski_onay_form_',
    dateField:   'baskiOnayTarihi',
    personField: 'baskiOnayHazirlayan',
    dateLabel:   'BASKI ONAY TARİHİ',
    personLabel: 'HAZIRLAYAN',
    // Dedicated fields (unlike demo/ozalit's buried ADET custom row, which
    // never rendered or printed once a project had a catalog — see the load
    // effect below for the fallback chain that fills adetField).
    adetField:     'baskiOnayAdet',
    adetLabel:     'ADET',
    locationField: 'basimYeri',
    locationLabel: 'BASIM YERİ',
    attemptField: 'baski_onay_attempt',
    title: 'Baskı Onay Formu',
    attemptWord: 'Baskı Onay',
    attemptUpper: 'BASKI ONAY',
    systemFieldsEditable: true,
    restoreSavedOnEdit: true,
    celebrateOnAdvance: false,
    saveRequiresEditable: true,
    isReadOnly: ({ mode, user }) => mode === 'history' || user?.role !== 'team_leader',
    canPrint: () => true,
    advanceToast: () => 'Baskı onaya gönderildi.',
    advanceLabel: () => 'Gönderin',
    saveToast: 'Baskı onay formu kaydedildi.',
  },
}

/* ------------------------------------------------------------------ */
/*  localStorage persistence                                          */
/* ------------------------------------------------------------------ */

const STORAGE_KEY  = (variant, id)          => `${variant.storagePrefix}${id}`
const SNAPSHOT_KEY = (variant, id, attempt) => `${variant.storagePrefix}${id}_snap_${attempt}`

// Old field names → display labels (for migrating pre-restructure saved data)
const OLD_FIELD_ORDER  = ['settekiKitapSayisi','adet','ebat','sayfaSayisi','icKagitCinsi','kapakKagitCinsi','cilt','laminasyon','kagitDahilBirimFiyat','basimYeri']
const OLD_FIELD_LABELS = {
  settekiKitapSayisi:   'SETTEKİ KİTAP SAYISI',
  adet:                 'ADET',
  ebat:                 'EBAT',
  sayfaSayisi:          'SAYFA SAYISI',
  icKagitCinsi:         'İÇ KAĞIT CİNSİ',
  kapakKagitCinsi:      'KAPAK KAĞIT CİNSİ',
  cilt:                 'CİLT',
  laminasyon:           'LAMİNASYON',
  kagitDahilBirimFiyat: 'KAĞIT DAHİL BİRİM FİYAT',
  basimYeri:            'BASIM YERİ',
}

function knownFields(variant) {
  const fields = ['isinAdi', variant.dateField, variant.personField, 'teslimEdenKisi', 'teslimTarihi', 'onaylayanKisi', 'matbaaYetkilisi']
  if (variant.adetField) fields.push(variant.adetField)
  if (variant.locationField) fields.push(variant.locationField)
  return new Set(fields)
}

function parseSaved(variant, raw) {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const form = {}
    const migrated = []
    for (const key of knownFields(variant)) if (parsed[key] !== undefined) form[key] = parsed[key]
    for (const key of OLD_FIELD_ORDER) {
      if (parsed[key]) migrated.push({ id: Math.random(), label: OLD_FIELD_LABELS[key], value: parsed[key] })
    }
    const allRows = [...(parsed._customRows ?? []), ...migrated].filter((r) => r.label || r.value)
    return { form, customRows: allRows, selectedComponents: parsed._selectedComponents ?? null }
  } catch { return null }
}

function loadSaved(variant, id)             { return parseSaved(variant, localStorage.getItem(STORAGE_KEY(variant, id))) }
function loadSnapshot(variant, id, attempt) { return parseSaved(variant, localStorage.getItem(SNAPSHOT_KEY(variant, id, attempt))) }

/**
 * Fields that record a specific EVENT on a specific attempt — the matbaa
 * delivered and signed it, the team leader approved it. Unlike the spec itself
 * (rows, parça selection, İŞİN ADI) these must never be inherited by a later
 * attempt.
 *
 * Both non-attempt-scoped sources are "latest wins": STORAGE_KEY is a single
 * blob per project overwritten on every save, and fetchServerSnapshot(…, null)
 * returns the newest demos row for the project+kind. So once ANY attempt was
 * approved, its onaylayanKisi got layered back onto every subsequent open —
 * printing a signed "ONAYLAYAN KİŞİ" on a fresh, unapproved sheet. The same
 * applies to matbaaYetkilisi: the matbaa who signed round 1 must not appear on
 * round 2's sheet, which may well be delivered by someone else.
 */
const STAMP_FIELDS = ['onaylayanKisi', 'teslimTarihi', 'teslimEdenKisi', 'matbaaYetkilisi']

function stripStamps(data) {
  if (!data) return data
  const form = { ...(data.form ?? {}) }
  for (const f of STAMP_FIELDS) delete form[f]
  return { ...data, form }
}

/**
 * A blank stamp means "this hasn't happened yet" — NOT "this was signed by
 * nobody". emptyForm writes matbaaYetkilisi:'' for every non-printer, so the
 * designer's very first save persists an empty signature; layering that saved
 * payload straight over the fresh form then wiped the printer's own pre-filled
 * name back to ''. That's why the matbaa's signature never reached the sheet
 * he delivered. Dropping blank stamps before the merge lets `fresh` win when
 * the saved payload has nothing real to say.
 */
function withoutBlankStamps(form) {
  const out = { ...(form ?? {}) }
  for (const f of STAMP_FIELDS) if (!out[f]) delete out[f]
  return out
}


/** Which spec sheet (if any) a project stage belongs to. */
const STAGE_VARIANT = {
  demo_teslim: 'demo',
  cin_demo_teslim: 'demo',
  demo_onay: 'demo',
  cin_demo_onay: 'demo',
  ozalit_teslim: 'ozalit',
  ozalit_onay: 'ozalit',
  baski_onay: 'baski_onay',
  cin_baski_onay: 'baski_onay',
}

export function specVariantForStage(stage) {
  return STAGE_VARIANT[stage] ?? null
}

/**
 * Server-side snapshots (demos table). localStorage only exists on the
 * browser that filled the form — the matbaa or the leader opening the same
 * project on another computer saw an empty sheet. Every save/submit also
 * POSTs the payload to /api/demos keyed by (project, kind, attempt); this
 * fetches the latest matching row back. Returns null on any failure so the
 * localStorage path stays the fallback.
 *
 * `attempt` may be a number, null (any attempt), or an ARRAY of attempt
 * numbers — /api/demos is append-only and ordered newest-first, so an array
 * resolves to whichever of those slots was written last. See liveAttempts
 * below for why a single round can span two slots.
 *
 * `orderId` picks the ROUND's owner (migration 053): null for a project's own
 * demo/ozalit round, an order id for a sipariş's. A sipariş sheet carries the
 * same project_id and kind as the project's own, so this filter is not
 * optional — without it the project's Ozalit Formu would open whichever
 * sipariş happened to save last, and vice versa.
 */
async function fetchServerSnapshot(api, variant, projectId, attempt, orderId = null) {
  try {
    const all = await api.listDemos()
    const wanted = attempt == null ? null : new Set(Array.isArray(attempt) ? attempt : [attempt])
    const mine = (all ?? []).filter(
      (d) => d.project_id === projectId && (d.kind ?? 'demo') === variant.kind &&
             (d.order_id ?? null) === (orderId ?? null) &&
             (wanted == null || wanted.has(d.attempt)),
    )
    if (mine.length === 0) return null
    // listDemos is ordered newest-first; take the most recent row.
    const row = mine[0]
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
    const parsed = parseSaved(variant, JSON.stringify(payload ?? {}))
    // `attempt` rides along so callers that also WRITE can put the sheet back
    // in the slot it came from instead of assuming attemptNo (see
    // writeAttempt) — it matters only when an array was passed.
    return parsed && { ...parsed, attempt: row.attempt }
  } catch {
    return null
  }
}

/** One exact snapshot row, addressed by id rather than by attempt slot. */
async function fetchServerSnapshotById(api, variant, demoId) {
  try {
    const all = await api.listDemos()
    const row = (all ?? []).find((d) => d.id === demoId)
    if (!row) return null
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
    const parsed = parseSaved(variant, JSON.stringify(payload ?? {}))
    return parsed && { ...parsed, attempt: row.attempt }
  } catch {
    return null
  }
}

/**
 * Move the row with `id` one place up (dir -1) or down (dir +1). Returns the
 * list untouched when the row is already at that end, so the caller can wire
 * the arrows without bounds-checking twice.
 */
function moveById(rows, id, dir) {
  const list = rows ?? []
  const from = list.findIndex((r) => r.id === id)
  const to = from + dir
  if (from < 0 || to < 0 || to >= list.length) return list
  const next = [...list]
  const [row] = next.splice(from, 1)
  next.splice(to, 0, row)
  return next
}

function saveForm(variant, id, data, customRows, selectedComponents) {
  localStorage.setItem(STORAGE_KEY(variant, id), JSON.stringify({
    ...data,
    _customRows: customRows,
    _selectedComponents: selectedComponents ?? null,
  }))
}
function saveSnapshot(variant, id, attempt, data, customRows, selectedComponents) {
  localStorage.setItem(SNAPSHOT_KEY(variant, id, attempt), JSON.stringify({
    ...data,
    _customRows: customRows,
    _selectedComponents: selectedComponents ?? null,
  }))
}

/**
 * Stamp signature fields onto a demo/ozalit sheet from OUTSIDE this dialog.
 *
 * Not every teslim/onay opens the spec form. The matbaa's "Teslim Et" on Demo
 * Talepleri and the leader's "Onayla" on Demo Onayı both run through the bare
 * ApprovalDialog, which advances the project without the sheet ever being
 * mounted — so the delivery and the approval happened, but the form printed
 * with an empty MATBAA YETKİLİSİ / ONAYLAYAN KİŞİ box. This gives those
 * callers the same three writes the dialog performs: the project-level blob,
 * the attempt-scoped snapshot, and the server snapshot.
 *
 * `project` must be the state BEFORE the transition — the attempt counter is
 * only bumped by rejects / re-sends / not-received, never by a teslim or an
 * onay, so this lands on the same attempt the dialog would have used.
 *
 * `order` does the same for a sipariş's own ozalit round (migration 053):
 * TalepSignDialog signs matbaa_onay without mounting the sheet, exactly the
 * way ApprovalDialog does on the main pipeline, and the sipariş's sheet was
 * left with an empty ONAYLAYAN KİŞİ / MATBAA YETKİLİSİ box for the same
 * reason. Pass it and the round is read and written under the order's id and
 * its own attempt counter; omit it and this behaves as before.
 */
export async function stampSpecSignature(variantName, project, patch, { order = null } = {}) {
  const variant = VARIANTS[variantName]
  if (!variant || !project?.id) return
  const orderId = order?.id ?? null
  const scopeId = orderId ?? project.id
  const attempt = ((order ? order.ozalit_attempt : project[variant.attemptField]) ?? 0) + 1
  // Same precedence as the dialog's own load: this attempt's snapshot is
  // authoritative; the project-level blob is a spec-only fallback with the
  // previous round's stamps stripped.
  // The server sources matter most here: this can run on a machine that never
  // opened the form, where localStorage holds nothing at all. Without the
  // server fallbacks the signature would be written onto an otherwise empty
  // snapshot and take the spec's place.
  // [attempt, attempt + 1]: a leader who edited the sent sheet saved it one
  // slot past the round's own (see liveAttempts), and the teslim/onay
  // signature belongs on THAT spec, not the superseded one. The write below
  // stays at `attempt` — being the newest row, it's what the live lookup
  // returns from then on.
  const existing =
    (await fetchServerSnapshot(api, variant, project.id, [attempt, attempt + 1], orderId)) ??
    loadSnapshot(variant, scopeId, attempt) ??
    stripStamps(loadSaved(variant, scopeId)) ??
    stripStamps(await fetchServerSnapshot(api, variant, project.id, null, orderId)) ??
    { form: {}, customRows: [], selectedComponents: null }
  const form = { ...(existing.form ?? {}), ...patch }
  const customRows = existing.customRows ?? []
  const selectedComponents = existing.selectedComponents ?? null
  // Back into the slot the sheet came from: stamping an edited sheet into the
  // round's own slot would bury the as-first-sent snapshot Geçmiş reopens.
  const slot = existing.attempt ?? attempt
  saveForm(variant, scopeId, form, customRows, selectedComponents)
  saveSnapshot(variant, scopeId, slot, form, customRows, selectedComponents)
  try {
    await api.createDemo({
      project_id: project.id,
      order_id: orderId,
      kind: variant.kind,
      attempt: slot,
      silent: true,
      payload: { ...form, _customRows: customRows, _selectedComponents: selectedComponents },
    })
  } catch { /* localStorage still has it; never block the transition */ }
}

function emptyForm(variant, project, user) {
  const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
  return {
    isinAdi: project?.title ?? '',
    [variant.dateField]: today,
    [variant.personField]:
      // The requester is always the signed-in user who clicks the action —
      // not editable. Falls back to the project's first assignee only if the
      // dialog is opened outside a session (rare; for safety).
      (user?.name ?? '') ||
      (project?.assignees ?? []).map((a) => a.name).join(', ') ||
      project?.assigned_name ||
      '',
    // Left blank until the team leader actually approves (stamped in
    // handleApprove) — pre-filling this here made every unapproved sheet
    // (still at ozalit_teslim/ozalit_onay, still pending) show a filled
    // "Ekip Lideri / Onaylayan" signature before any approval had happened.
    onaylayanKisi: '',
    matbaaYetkilisi: user?.role === 'printer' ? (user?.name ?? '') : '',
  }
}

/**
 * The Baskı Onay Formu's must-fill fields, returned as the labels of whichever
 * are still blank.
 *
 * ADET and BASIM YERİ are the two facts the matbaa physically prints from, and
 * this sheet is the last gate before baskıda — a sheet that goes out with
 * either one blank is a sheet nobody can print. Nothing on the path used to
 * check, so both could (and did) ship empty. Only the baski_onay variant
 * declares these fields, so every other variant gets an empty list.
 */
function missingRequiredFields(variant, form) {
  return [
    [variant.adetField, variant.adetLabel],
    [variant.locationField, variant.locationLabel],
  ]
    .filter(([field]) => field && !String(form?.[field] ?? '').trim())
    .map(([, label]) => label)
}

/* ------------------------------------------------------------------ */
/*  Print sheet                                                       */
/* ------------------------------------------------------------------ */

/**
 * Print every selected parça in ONE job (one classic sheet per parça, page
 * break between). If nothing is selected, prints the single custom-row sheet.
 * Uses the shared specPrint helper so Dökümanlar and this dialog stay in sync.
 */
function openMultiPrint({ form, customRows, project, attemptNo, kind, selectedComponents }) {
  const attemptLabel = `${attemptNo}. ${kind === 'ozalit' ? 'OZALİT' : kind === 'baski_onay' ? 'BASKI ONAY' : 'DEMO'}`
  const selected = (selectedComponents ?? []).filter(Boolean)
  const comps = selected.length > 0
    ? selected
    : [{ component: form.isinAdi || project?.title || '', rows: (customRows ?? []).filter((r) => r.label) }]
  // Each sheet is headed by the job and names its own parça as İŞİN ADI —
  // otherwise the KUTU sheet would read as the book itself.
  const sheets = comps.map((c) => buildFormSheet({ component: c, form, kind, title: project?.title || '', attemptLabel }))
  const ok = printSpecSheets(sheets, { docTitle: `${attemptLabel} — ${project?.title ?? ''}` })
  if (!ok) toast.error('Pop-up engelleyiciyi kontrol edin.')
}

/* ------------------------------------------------------------------ */
/*  Shared spec-sheet dialog                                          */
/* ------------------------------------------------------------------ */

/**
 * Shared Demo / Ozalit spec-sheet dialog. Pick a variant via the `variant`
 * prop ('demo' | 'ozalit'); everything variant-specific lives in VARIANTS.
 *
 * mode:
 *   'advance'  — send the sheet onward (api.advanceProject)
 *   'approve'  — team leader approves and sends to production (api.approveProject; ozalit)
 *   'view'     — edit current saved form
 *   'history'  — read-only snapshot view (requires viewAttempt)
 *
 * viewAttempt — attempt number to load from snapshot (used with mode='history')
 * viewDemoId — exact snapshot row to load, when the timeline row that opened
 *   this dialog recorded one (migration 052). Two corrections of one round
 *   share an attempt slot, so viewAttempt alone always resolves to the later
 *   of them; this addresses the sheet directly. Falls back to viewAttempt for
 *   rows written before the migration.
 * viewAttemptLabel — round number to PRINT on that snapshot. An edit is
 *   stored one slot past its round (see liveAttempts), so a correction to the
 *   1st demo lives at slot 2 and would otherwise open titled "2. Demo" — a
 *   round that hasn't happened, contradicting the "Demo 1" badge on the very
 *   row that opened it. Display only; every lookup still uses viewAttempt.
 * notifyOnSave — mode='view' only. When true, Kaydet also logs a history
 *   entry and notifies the matbaa the sheet changed (see handleSave) instead
 *   of the normal silent in-place save.
 * onStartWork / startingWork — mode='view' only. When onStartWork is passed
 *   (the printer may still mark demo-start/ozalit-start), the footer offers
 *   an "İşlemi Başlatın" button so they review the spec sheet before
 *   confirming they've begun physical work, instead of starting blind.
 * rejectContext — { reason, target } — used with mode='advance' when a
 *   team-leader reject-to-matbaa (ApprovalDialog) hands off here instead of
 *   submitting blind: the leader reviews/edits the existing sheet matbaa will
 *   redeliver, and THIS dialog's submit is what actually calls
 *   api.rejectProject (with the reason already collected), not advanceProject.
 *   Forces the saved sheet to load as-is (like a read-only viewer would)
 *   instead of the normal "fresh compose" reset for a new attempt.
 */
export default function SpecFormDialog({ variant: variantName = 'demo', open, onOpenChange, project, order = null, mode, onDone, viewAttempt, viewAttemptLabel = null, viewDemoId = null, notifyOnSave = false, onStartWork, startingWork = false, rejectContext = null }) {
  const variant = VARIANTS[variantName]
  const { user } = useAuth()
  const { updateOne } = useProjectsStore()
  /* ── Whose ozalit round is this? ────────────────────────────────────────
   * A sipariş (order) runs the SAME sheet as the project's own pipeline —
   * same Baskı Reçeteleri source, same rounds, same İSTEM/TESLİM/ONAY
   * stamps, same print output. It just keeps them under its own id
   * (migration 053) so two concurrent reprints of one title don't share a
   * sheet. `round` is the only place that knows which entity owns the
   * round; everything below reads it instead of reaching into `project`.
   *
   * The reçete itself stays project-scoped on purpose: a reprint is a
   * reprint of the same product, and Ürün Bilgileri / Baskı Reçeteleri is
   * the one catalog both pipelines read and write.
   */
  const orderScoped = !!order
  // Snapshot + localStorage scope. Order ids and project ids never collide,
  // so one key space serves both.
  const scopeId = order?.id ?? project?.id
  const orderId = order?.id ?? null
  const round = orderScoped
    ? {
      attempt: order.ozalit_attempt,
      started: !!order.ozalit_started,
      fixPending: !!order.ozalit_fix_pending,
      received: !!order.matbaa_received,
      receivedBy: order.matbaa_received_by,
      // Leader-first, read off the order's own ledger — the twin of
      // ozalitLeaderApproved(project) on the main pipeline.
      leaderApproved: (order.matbaa_approvals ?? []).some((a) => a.role === 'team_leader'),
      designerIds: Array.isArray(order.assignee_ids) ? order.assignee_ids : [],
    }
    : {
      attempt: project?.[variant.attemptField],
      started: variant.kind === 'demo' ? !!project?.demo_started : !!project?.ozalit_started,
      fixPending: variant.kind === 'demo' ? !!project?.demo_fix_pending : !!project?.ozalit_fix_pending,
      received: !!project?.ozalit_received,
      receivedBy: project?.ozalit_received_by,
      leaderApproved: ozalitLeaderApproved(project),
      designerIds: (project?.assignees ?? []).map((a) => a.id),
    }
  const celebrate = useDesignerCelebration()
  const [form, setForm] = useState(() => emptyForm(variant, project, user))
  const [customRows, setCustomRows] = useState([])
  const [selectedComponents, setSelectedComponents] = useState([]) // [{ id, component, rows }]
  // Empty for every variant but baski_onay — see missingRequiredFields. Each
  // write path below refuses while it is non-empty, and the footer disables
  // its actions with the reason spelled out rather than only toasting on click.
  const missingRequired = missingRequiredFields(variant, form)
  function requiredFilled() {
    if (missingRequired.length === 0) return true
    toast.error(`${missingRequired.join(' ve ')} boş bırakılamaz.`)
    return false
  }
  // Slot the sheet on screen was actually loaded from — null until the load
  // effect resolves it. See liveAttempts / writeAttempt below.
  const [liveAttemptNo, setLiveAttemptNo] = useState(null)
  const [busy, setBusy] = useState(false)
  // Bumped once the server spec has been fetched for this project, so the
  // catalog memo below recomputes with fresh data even on a cold cache.
  const [catalogVersion, setCatalogVersion] = useState(0)
  // Ozalit receipt gate (migration 035) — see the block below the effects.
  const [receiving, setReceiving] = useState(false)
  const [receivedLocal, setReceivedLocal] = useState(false)
  const [confirmReceive, setConfirmReceive] = useState(false)

  // Matbaa "Başladım" gate (migration 048): once the printer has started
  // physical work, the leader/assigned designer can no longer silently save
  // an edit here — they have to go through "Değişiklik İste" in
  // ProjectDetail.jsx and wait for the matbaa's accept. Scoped to
  // mode==='view' only — the printer's own delivery-stamp edits
  // (mode='advance'/'approve') and history snapshots are unaffected.
  const lockedByStart = mode === 'view' && round.started
  // Migration 049: once the matbaa accepts a change request, the fix is owed
  // and must go through the dedicated notify path (notifyOnSave=true) — the
  // plain "Demo Formu"/"Ozalit Formu" button stays view-only here so there's
  // no silent way to make the fix without the matbaa being told.
  const lockedByFixPending = mode === 'view' && !notifyOnSave && round.fixPending
  /* The one sipariş step whose sheet the DESIGNER writes: "Ozalit İsteyin"
     (order status 'kontrol_edildi', migration 054). VARIANTS.ozalit locks
     designers out because on the project pipeline the team leader is the
     author of that sheet — here the designer IS the requester, and this form
     is the request. Every other order step still arrives read-only for them
     (the matbaa's teslim, the leader's matbaa_onay approve), and a history
     snapshot stays read-only for everyone. */
  const authoringOrderOzalit =
    orderScoped && mode === 'advance' && order?.status === 'kontrol_edildi'
  const readOnly =
    (variant.isReadOnly({ mode, user }) && !authoringOrderOzalit) || lockedByStart || lockedByFixPending
  const printable = variant.canPrint({ user, project, readOnly })
  // The plain "Demo Formu" button (mode='view', no notify) always opens a
  // round that has ALREADY been sent: at demo_onay it's the sheet sitting with
  // the leader, and from ozalit_teslim onward it's the sheet the demo was
  // APPROVED on. It therefore has to reopen exactly as it was sent and signed.
  // The demo variant's restoreSavedOnEdit:false is about composing a NEW
  // round; treating this viewer as composing stamped today's date, the
  // viewer's own name as DEMO İSTEYEN KİŞİ and a blank ONAYLAYAN KİŞİ over the
  // approved sheet — the approval signature stampSpecSignature had just
  // written into that very snapshot. (Ozalit / Baskı Onay already restore via
  // restoreSavedOnEdit, so in practice this only changes demo.)
  // Excluded on purpose: "Gönderilen Demoyu Düzenleyin" (notifyOnSave), whose
  // target is the round's separate edit slot, and mode='advance', which really
  // is a fresh compose.
  const viewingSentSheet = mode === 'view' && !notifyOnSave

  // Pull the authoritative spec from the server when the dialog opens. The
  // in-memory cache is normally primed at boot, but a project created on
  // another browser (or just created moments ago) may not be there yet — this
  // guarantees the matbaa/designer/leader all see the same, correct parçalar.
  useEffect(() => {
    if (!open || !project?.id) return
    let cancelled = false
    api.getProductInfo(project.id)
      .then((comps) => {
        if (cancelled) return
        primeProductInfoCache([{ project_id: project.id, components: comps }])
        setCatalogVersion((v) => v + 1)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open, project?.id])

  // Catalog of all components defined for this project (from Ürün Bilgileri).
  const catalogComponents = useMemo(
    () => getComponentsForProject(project?.id).map((c) => ({
      id: c.component,                 // component name is the stable id
      component: c.component,
      rows: getComponentRows(c),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project?.id, catalogVersion]
  )

  useEffect(() => {
    if (!open || !project) return
    let cancelled = false

    async function load() {
      setLiveAttemptNo(null)
      if (viewAttempt != null) {
        // History: show the snapshot exactly as it was saved — no auto-fills.
        // Server snapshot first (works on any computer), localStorage fallback.
        const snap =
          (viewDemoId ? await fetchServerSnapshotById(api, variant, viewDemoId) : null) ??
          (await fetchServerSnapshot(api, variant, project.id, viewAttempt, orderId)) ??
          loadSnapshot(variant, scopeId, viewAttempt) ??
          loadSaved(variant, scopeId)
        if (cancelled) return
        setForm(snap?.form ?? emptyForm(variant, project, user))
        setCustomRows(snap?.customRows ?? [])
        setSelectedComponents(snap?.selectedComponents ?? [])
        return
      }

      // Attempt-scoped snapshot first: the stamps recorded on THIS attempt are
      // the only ones this sheet may show. Only if there's no snapshot for the
      // current attempt do we fall back to the project-level blob — and then
      // strictly for the spec, with the event stamps stripped (see
      // STAMP_FIELDS). Without that strip, a previously approved attempt's
      // ONAYLAYAN KİŞİ reappeared on the next, unapproved attempt.
      const current =
        (await fetchServerSnapshot(api, variant, project.id, liveAttempts, orderId)) ??
        loadSnapshot(variant, scopeId, attemptNo)
      if (cancelled) return
      // localStorage snapshots are keyed by attemptNo already, so only a
      // server hit can report a different slot.
      setLiveAttemptNo(current?.attempt ?? null)
      const carried =
        loadSaved(variant, scopeId) ??
        (await fetchServerSnapshot(api, variant, project.id, null, orderId))
      if (cancelled) return
      // Plain viewer (mode='view' && !notifyOnSave) is a personal draft —
      // localStorage is the source of truth so the user's edits show on
      // reopen and the printer is unaffected. Compose / notify / approve
      // still let the server's attempt-scoped snapshot win, because that IS
      // the shared state those flows mutate.
      const data = (mode === 'view' && !notifyOnSave)
        ? (stripStamps(carried) ?? current)
        : (current ?? stripStamps(carried))
      const fresh = emptyForm(variant, project, user)
      if (readOnly || variant.restoreSavedOnEdit || rejectContext || viewingSentSheet) {
        // Read-only viewers (printer, leader) — and the plain viewer of an
        // already-sent round (viewingSentSheet) — must see the values that
        // were actually saved at submission time; otherwise the form would
        // show today's date and the matbaa's own name as the requester. Layer
        // the saved form back on top so İŞİN ADI, İSTEM TARİHİ and İSTEYEN
        // KİŞİ reflect what was stamped. The teslim/onay stamps come through only
        // when `current` supplied them, i.e. they really happened — blank ones
        // are dropped so they can't overwrite a legitimately pre-filled
        // signature (see withoutBlankStamps).
        setForm({ ...fresh, ...withoutBlankStamps(data?.form) })
      } else {
        // Active editing: start from fresh, then keep only the printer-signed
        // field (matbaaYetkilisi). The system-driven fields auto-recompute.
        setForm({
          ...fresh,
          ...(data?.form?.matbaaYetkilisi ? { matbaaYetkilisi: data.form.matbaaYetkilisi } : {}),
        })
      }
      // First ozalit round on a project whose ozalit sheet is still empty:
      // borrow the spec the designer already filled in on the demo sheet.
      // See specWithDemoFallback.
      let spec = data
      if (variant.kind === 'ozalit' && !hasSpecContent(data)) {
        // A sipariş's first round borrows from how this product was last
        // printed — the project's own latest ozalit sheet — before falling
        // back to the demo sheet the project pipeline uses. Both are read
        // project-scoped (orderId omitted) on purpose: that IS the point of
        // the fallback. The parça rows come from Baskı Reçeteleri either way;
        // this only carries over the custom rows and İŞİN ADI.
        const fromPrevious = orderScoped
          ? (await fetchServerSnapshot(api, variant, project.id, null))
          : null
        if (cancelled) return
        const fromDemo = fromPrevious ??
          loadSaved(VARIANTS.demo, scopeId) ??
          (await fetchServerSnapshot(api, VARIANTS.demo, project.id, null))
        if (cancelled) return
        spec = specWithDemoFallback(data, fromDemo)
      }
      // Baskı Onay Formu always opens pre-filled with the LAST ozalit sheet's
      // information (per the feature ask) until a team leader edits and saves
      // their own — same borrow-once-then-keep-your-own-edits shape as the
      // ozalit-from-demo fallback above. ÇİN has no ozalit sheet (its mirror
      // gate, cin_baski_onay, sits right after cin_demo_onay), so it borrows
      // from the demo sheet instead — same fallback source TR's own ozalit
      // form uses on its first round.
      if (variant.kind === 'baski_onay' && !hasSpecContent(data)) {
        const fallbackVariant = project.type === 'CIN' ? VARIANTS.demo : VARIANTS.ozalit
        const fromFallback =
          loadSaved(fallbackVariant, scopeId) ??
          (await fetchServerSnapshot(api, fallbackVariant, project.id, null))
        if (cancelled) return
        spec = specWithDemoFallback(data, fromFallback)
      }
      const savedRows = spec?.customRows ?? []
      if (variant.kind === 'baski_onay') {
        // ADET gets its own top-of-sheet field here instead of living as a
        // buried custom row — that row never actually rendered or printed
        // once a project had a catalog (buildSpecRows / the parça cards both
        // skip customRows once parçalar are selected). Prefer a live sipariş
        // order's quantity; on a project's first pass (no order placed yet)
        // fall back to whatever ADET the borrowed ozalit sheet carried, then
        // drop that row so it isn't shown twice.
        let adetValue = data?.form?.[variant.adetField]
        let rowsForCustom = savedRows
        if (!adetValue) {
          // Renamed off `order` — that's the sipariş prop now.
          const lastOrder = loadOrderAdet(project.id)
          adetValue = lastOrder?.quantity ? formatNumber(lastOrder.quantity) : ''
          if (!adetValue) {
            const idx = savedRows.findIndex((r) => r.label?.toUpperCase().startsWith('ADET'))
            if (idx !== -1) {
              adetValue = savedRows[idx].value
              rowsForCustom = savedRows.filter((_, i) => i !== idx)
            }
          }
        }
        if (adetValue) setForm((f) => ({ ...f, [variant.adetField]: adetValue }))
        // BASIM YERİ has no live source to fall back on — no press is recorded
        // anywhere on the project — but the borrowed ozalit/demo sheet can
        // still carry one as a leftover custom row (pre-restructure forms had
        // it as a real field, see OLD_FIELD_LABELS). Lift it into the
        // dedicated row so a required field arrives filled instead of making
        // the leader retype what the previous sheet already said, and drop the
        // duplicate row. 'BASIM YER' as the prefix sidesteps the İ/I casing.
        let basimValue = data?.form?.[variant.locationField]
        if (!basimValue) {
          const idx = rowsForCustom.findIndex((r) => r.label?.toUpperCase().startsWith('BASIM YER'))
          if (idx !== -1) {
            basimValue = rowsForCustom[idx].value
            rowsForCustom = rowsForCustom.filter((_, i) => i !== idx)
          }
        }
        if (basimValue) setForm((f) => ({ ...f, [variant.locationField]: basimValue }))
        setCustomRows(rowsForCustom)
      } else {
        const hasAdet = savedRows.some((r) => r.label?.toUpperCase().startsWith('ADET'))
        // A sipariş carries the ordered quantity on the order itself, so its
        // sheet reads it straight off the row. buildAdetRows is the project
        // pipeline's fallback: localStorage, keyed by project, most recent
        // order only — invisible on every other browser, and silently
        // clobbered by the next order on the same title.
        const adetRows = orderScoped ? buildOrderAdetRows(order) : buildAdetRows(project.id)
        setCustomRows(hasAdet ? savedRows : [...adetRows, ...savedRows])
      }
      // null means never explicitly set — default to all catalog components checked.
      // [] means the user intentionally cleared them — respect that.
      const savedComponents = spec?.selectedComponents ?? null
      setSelectedComponents(savedComponents ?? catalogComponents)
    }

    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // scopeId, not project.id: switching between two sipariş sheets on the
    // same product has to reload, and for a project's own round the two are
    // the same value.
  }, [open, scopeId, viewAttempt, viewDemoId])

  /**
   * Baseline for the "Değişiklikler" diff panel (migration 049) — a snapshot
   * of what the matbaa currently has, captured once when the dedicated
   * "Gönderilen Demoyu/Ozaliti Düzenleyin" button opens the dialog. Only
   * meaningful there (notifyOnSave=true); left null otherwise so the panel
   * never renders on the plain view/edit path. Deliberately a fresh fetch
   * rather than reusing the state the load effect above sets — that effect
   * merges in fresh-form defaults for non-editable system fields, which
   * would show up as false "changes".
   */
  const [baseline, setBaseline] = useState(null)
  useEffect(() => {
    if (!open || !project?.id || !notifyOnSave) { setBaseline(null); return }
    let cancelled = false
    ;(async () => {
      const current =
        (await fetchServerSnapshot(api, variant, project.id, attemptNo, orderId)) ??
        loadSnapshot(variant, scopeId, attemptNo)
      if (cancelled) return
      const carried =
        loadSaved(variant, scopeId) ??
        (await fetchServerSnapshot(api, variant, project.id, null, orderId))
      if (cancelled) return
      const data = current ?? stripStamps(carried)
      setBaseline({
        customRows: data?.customRows ?? [],
        selectedComponents: data?.selectedComponents ?? null,
      })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scopeId, notifyOnSave])

  /** Rows changed since baseline, by matching row `id` (stable across a save
   * cycle — new rows only get a fresh id when actually added). Shared by the
   * custom-rows diff and the per-parça-component diff below. */
  function diffRows(baseRows, liveRows, prefix) {
    const entries = []
    const baseById = new Map((baseRows ?? []).map((r) => [String(r.id), r]))
    const liveIds = new Set()
    for (const r of liveRows ?? []) {
      liveIds.add(String(r.id))
      const b = baseById.get(String(r.id))
      const label = r.label || b?.label || 'Satır'
      if (!b) {
        if (r.label || r.value) entries.push({ status: 'added', label: `${prefix}${label}`, newValue: r.value || '—' })
      } else if (b.label !== r.label || b.value !== r.value) {
        entries.push({ status: 'changed', label: `${prefix}${label}`, oldValue: b.value || '—', newValue: r.value || '—' })
      }
    }
    for (const b of baseRows ?? []) {
      if (!liveIds.has(String(b.id)) && (b.label || b.value)) {
        entries.push({ status: 'removed', label: `${prefix}${b.label || 'Satır'}`, oldValue: b.value || '—' })
      }
    }
    return entries
  }

  const changeSummary = useMemo(() => {
    if (!baseline) return null
    const entries = [...diffRows(baseline.customRows, customRows, '')]

    const baseComponents = baseline.selectedComponents ?? catalogComponents
    const baseCompById = new Map(baseComponents.map((c) => [c.id, c]))
    const liveCompIds = new Set()
    for (const c of selectedComponents) {
      liveCompIds.add(c.id)
      const b = baseCompById.get(c.id)
      if (!b) {
        entries.push({ status: 'added', label: 'Parça eklendi', newValue: c.component })
        continue
      }
      entries.push(...diffRows(b.rows, c.rows, `${c.component} — `))
    }
    for (const b of baseComponents) {
      if (!liveCompIds.has(b.id)) entries.push({ status: 'removed', label: 'Parça kaldırıldı', oldValue: b.component })
    }
    return entries
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline, customRows, selectedComponents, catalogComponents])

  /* ── Ozalit "Teslim Alındı" gate ──────────────────────────────────────────
   * The ozalit approve is refused server-side until the physical proof has
   * been acknowledged (migration 035), so this dialog — which is where the
   * Onaylar page and the project detail both sign off — has to offer the
   * acknowledgment inline rather than bouncing the user with an error toast.
   * Same shape as ApprovalDialog's demo gate; `receivedLocal` reflects a click
   * made in this session, before the parent re-passes the updated project.
   */
  const isOzalitApproval = mode === 'approve' && variantName === 'ozalit'
  const ozalitReceived = round.received || receivedLocal
  const needsOzalitReceive = isOzalitApproval && !ozalitReceived
  const canAckOzalit =
    user?.role === 'team_leader' ||
    (user?.role === 'designer' && round.designerIds.includes(user?.id))

  /* ── Ozalit leader-first gate ─────────────────────────────────────────────
   * The second ordering rule on the same approve: a designer counter-signs an
   * ozalit only after a team leader has approved it (computeOzalitOnayApproval
   * refuses otherwise). Nothing for the designer to click here — unlike the
   * receipt gate, they can't open it themselves — so the button is disabled
   * with the reason spelled out.
   */
  const ozalitAwaitingLeader =
    isOzalitApproval && user?.role === 'designer' && !round.leaderApproved

  /* ── Baskı Onayı dual-approval (migration 045) ────────────────────────────
   * One team leader PREPARES the form; a DIFFERENT team leader gives the
   * actual "Baskı Onayı". The server is the source of truth for "different
   * person" (it also lets a lone remaining leader self-approve rather than
   * strand the project) — this dialog just switches which button it shows
   * based on `baski_onay_prepared`, and lets a server error surface via toast
   * on the rare self-approve-blocked click.
   */
  const isBaskiOnayApproval = mode === 'approve' && variantName === 'baski_onay'
  const baskiOnayPrepared = !!project?.baski_onay_prepared

  // Each (re)open starts from the project's own state — a stale local ack
  // would otherwise unlock the button for the next project opened.
  useEffect(() => {
    if (!open) return
    setReceivedLocal(false)
    setConfirmReceive(false)
  }, [open, scopeId])

  async function handleReceiveOzalit() {
    if (!project) return
    setReceiving(true)
    try {
      // Same gate, two ledgers: projects.ozalit_received (migration 035) and
      // order_requests.matbaa_received (migration 038).
      const updated = orderScoped
        ? await api.matbaaReceiveOrder(order.id)
        : await api.receiveOzalit(project.id)
      if (!orderScoped) updateOne(updated)
      setReceivedLocal(true)
      setConfirmReceive(false)
      toast.success('Ozalit teslim alındı.')
      onDone?.(updated)
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally {
      setReceiving(false)
    }
  }

  function toggleComponent(compId) {
    if (readOnly) return
    setSelectedComponents((prev) => {
      const exists = prev.find((c) => c.id === compId)
      if (exists) return prev.filter((c) => c.id !== compId)
      const fromCatalog = catalogComponents.find((c) => c.id === compId)
      if (!fromCatalog) return prev
      // Demo: İŞİN ADI is locked to the project title — never overwritten here.
      // Ozalit: first selected component becomes İŞİN ADI.
      if (variant.systemFieldsEditable && prev.length === 0) {
        setForm((f) => ({ ...f, isinAdi: fromCatalog.component }))
      }
      return [...prev, fromCatalog]
    })
  }
  function selectAllComponents() {
    if (readOnly) return
    setSelectedComponents(catalogComponents)
    if (variant.systemFieldsEditable && catalogComponents[0]) {
      setForm((f) => ({ ...f, isinAdi: catalogComponents[0].component }))
    }
  }
  function clearComponents() {
    if (readOnly) return
    setSelectedComponents([])
  }

  function addCustomRow() {
    setCustomRows((prev) => [...prev, { id: Date.now() + Math.random(), label: '', value: '' }])
  }
  function updateCustomRow(id, field, val) {
    setCustomRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: val } : r)))
  }
  function removeCustomRow(id) {
    setCustomRows((prev) => prev.filter((r) => r.id !== id))
  }
  // Rows are added under İŞİN ADI and the order they are left in is the order
  // they print in, so moving one is a real edit, not a view preference.
  function moveCustomRow(id, dir) {
    setCustomRows((prev) => moveById(prev, id, dir))
  }

  // ── Per-component (parça) spec editing ──────────────────────────────────────
  // Each selected component carries its own auto-filled rows. Editing them here
  // updates the component in place; on save these are merged back into Ürün
  // Bilgileri (see saveEditedComponents in the save handlers below).
  function updateComponentRow(compId, rowId, field, val) {
    setSelectedComponents((prev) =>
      prev.map((c) =>
        c.id !== compId
          ? c
          : { ...c, rows: (c.rows ?? []).map((r) => (r.id === rowId ? { ...r, [field]: val } : r)) },
      ),
    )
  }
  function addComponentRow(compId) {
    setSelectedComponents((prev) =>
      prev.map((c) =>
        c.id !== compId
          ? c
          : { ...c, rows: [...(c.rows ?? []), { id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, label: '', value: '' }] },
      ),
    )
  }
  function removeComponentRow(compId, rowId) {
    setSelectedComponents((prev) =>
      prev.map((c) => (c.id !== compId ? c : { ...c, rows: (c.rows ?? []).filter((r) => r.id !== rowId) })),
    )
  }
  function moveComponentRow(compId, rowId, dir) {
    setSelectedComponents((prev) =>
      prev.map((c) => (c.id !== compId ? c : { ...c, rows: moveById(c.rows ?? [], rowId, dir) })),
    )
  }
  function handleChange(e) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  // Re-sending a demo from a demo stage bumps demo_attempt on the server at
  // submit time (see server transitions: "Re-send starts a new demo round").
  // While composing that re-send the stored counter is still the *previous*
  // attempt, so naively showing demo_attempt+1 leaves the form one behind —
  // it reads "1. DEMO" on the 2nd demo, "2. DEMO" on the 3rd, etc. Add the
  // extra +1 so the form (and the snapshot it saves) already reflect the
  // number this demo will carry once sent. First demo / post-reject revisions
  // advance from Tasarım (no bump) and the matbaa's delivery isn't a re-send,
  // so those keep demo_attempt+1.
  const DEMO_RESEND_STAGES = new Set(['demo_teslim', 'demo_onay', 'cin_demo_teslim', 'cin_demo_onay'])
  const willResendBump =
    variant.kind === 'demo' &&
    !orderScoped &&
    mode === 'advance' &&
    user?.role !== 'printer' &&
    DEMO_RESEND_STAGES.has(project?.stage)
  // Editing an already-sent round ("Gönderilen Demoyu/Ozaliti Düzenleyin",
  // mode='view' + notifyOnSave) must not overwrite the pristine as-first-sent
  // snapshot at the round's own attempt slot — ProjectHistory's edit-history
  // row (MinorRow) always links to attemptAt+1 so the original stays intact
  // and reopenable. Without this bump, handleSave wrote the edit back into
  // the SAME slot the round was first sent under (both computed the same
  // demo_attempt+1), so the edit silently replaced the original there while
  // the history row's own "+1" lookup found nothing and fell back to a
  // stale/unrelated snapshot — showing the wrong content under a misleading
  // "(N+1. Demo)" title. Bumping here keeps save and that lookup in sync.
  const willEditBump = mode === 'view' && notifyOnSave && viewAttempt == null
  const attemptNo =
    viewAttempt ?? ((round.attempt ?? 0) + (willResendBump || willEditBump ? 2 : 1))
  // Slots that can hold this round's CURRENT sheet. Because an edit-notify
  // save lands one slot past the round's own (willEditBump) and
  // /demo-edit-notify deliberately doesn't bump demo_attempt, the newest
  // content for a round may sit at attemptNo + 1 while attemptNo still holds
  // the as-first-sent snapshot Geçmiş links to. Anything showing an
  // already-sent round must therefore read the newer of the two: the plain
  // "Demo Formu" / "İşlemi Başlatın" viewer and the matbaa's own teslim form
  // both loaded attemptNo alone, so after the leader corrected a sent demo
  // the matbaa started work from — and delivered, re-saving — the pre-edit
  // spec. Excluded: composing a NEW round (its slot is empty by definition,
  // and the lookahead would drag the previous round's edit into a fresh
  // sheet) and the edit dialog itself, whose attemptNo already IS the edit
  // slot.
  const composingNewRound = mode === 'advance' && user?.role !== 'printer'
  const liveAttempts =
    composingNewRound || notifyOnSave ? attemptNo : [attemptNo, attemptNo + 1]
  // Saves go back to the slot the sheet was READ from, not blindly to
  // attemptNo. When the live sheet is the edit slot, the matbaa's teslim
  // stamps (handleAdvance) would otherwise land on attemptNo and overwrite
  // the as-first-sent snapshot — which is precisely the row Geçmiş's
  // "Demoya Gönderildi" reopens. The before/after pair the timeline shows
  // (original on the major row, correction on "Demo Formu Güncellendi") only
  // survives if each stays in its own slot. Composing a new round always
  // resolves to attemptNo, so this is a no-op there.
  const writeAttempt = liveAttemptNo ?? attemptNo
  // What the sheet CALLS this round, as opposed to where it's stored.
  const shownAttemptNo = viewAttemptLabel ?? attemptNo

  /**
   * Mirror the snapshot to the server so any browser can reopen it. Resolves
   * to the created row (or null if the POST failed) — handleSave needs its id
   * to stamp the timeline row, everyone else can ignore it.
   */
  function snapshotPayload(data) {
    return { ...data, _customRows: customRows, _selectedComponents: selectedComponents ?? null }
  }

  function persistServerSnapshot(attempt, data) {
    return api.createDemo({
      project_id: project.id,
      // NULL for the project's own round, the sipariş's id for its own
      // (migration 053) — this is what keeps two concurrent reprints of one
      // title off each other's sheet.
      order_id: orderId,
      kind: variant.kind,
      attempt,
      silent: true,
      payload: snapshotPayload(data),
    }).catch(() => null /* localStorage still has it; don't block the flow */)
  }

  // Write any edits made in the side-by-side parça cards back to Ürün Bilgileri
  // (the shared, server-side catalog) so a change made while requesting a demo
  // updates the product spec everywhere — and records who changed it. No-op in
  // read-only mode or for projects without a catalog.
  async function persistCatalogEdits() {
    if (readOnly || !catalogComponents.length || !selectedComponents?.length) return
    try { await saveEditedComponents(project.id, selectedComponents) } catch { /* non-blocking */ }
  }

  /**
   * Everything a successful step writes that ISN'T the step itself: the local
   * form cache, the round's snapshot slot, and the shared Ürün Bilgileri
   * catalog.
   *
   * Called AFTER the transition resolves, never before. These three used to
   * run first, so a transition the server refused — wrong stage, a stale
   * version, the matbaa having started — still left the edit committed
   * everywhere the app reads from, with only a toast to say the "notify"
   * half had failed. The transition is the authorization; nothing may be
   * written until it has passed.
   */
  async function persistAfterStep(payload, { catalog = true } = {}) {
    saveForm(variant, scopeId, payload, customRows, selectedComponents)
    saveSnapshot(variant, scopeId, writeAttempt, payload, customRows, selectedComponents)
    await persistServerSnapshot(writeAttempt, payload)
    if (catalog) await persistCatalogEdits()
  }

  /**
   * `routeOverride` is the sipariş resubmit choice: once an order has bounced
   * back to the designer (order.last_reject_type === 'designer'), the ozalit
   * request may go to the matbaa for another physical proof (the default,
   * 'tasarimci_onay') or to the team leader as a digital Ekran Onayı
   * ('ekran_onay'). The server refuses a route on a first submission, so it
   * is only ever sent when the footer actually offered the choice.
   */
  async function handleAdvance(routeOverride = null) {
    if (!project) return
    if (!requiredFilled()) return
    setBusy(true)
    try {
      // When the printer (matbaa) is the one advancing, stamp the
      // "teslim eden kişi" + "teslim tarihi" now. The original requester
      // stamp is preserved from the first save.
      //
      // The teslim IS the matbaa's signature on this sheet, so stamp
      // matbaaYetkilisi here too rather than trusting whatever was pre-filled:
      // the value loaded into `form` comes from a payload someone else saved,
      // and an earlier round's blank would otherwise ship an unsigned sheet.
      let payload = form
      if (user?.role === 'printer') {
        const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
        payload = {
          ...form,
          teslimEdenKisi: user?.name ?? '',
          teslimTarihi: today,
          matbaaYetkilisi: user?.name ?? '',
        }
      } else if (variant.kind === 'ozalit') {
        // Requesting the ozalit — the first ask or a resubmit after an
        // ozalit rejection — is always the current user's ask, even though
        // the field is read-only for designers and may still carry a
        // previous round's name from the loaded snapshot.
        payload = { ...form, [variant.personField]: user?.name ?? form[variant.personField] }
      }
      // The one write that must go BEFORE the transition, not after it. The
      // reçete is the designer's to edit because of the step they are ON
      // (kontrol_edildi — see PUT /product-info's designer window), and this
      // advance is what ends that step. Posted afterwards, like every other
      // path here does it, it would arrive against an order already at
      // tasarimci_onay and take a 403 that saveComponentsForProject swallows
      // as "offline": the parça edits would ship on the sheet and silently
      // never reach Baskı Reçeteleri. A refused advance leaves a reçete edit
      // the designer was entitled to make either way.
      if (authoringOrderOzalit) await persistCatalogEdits()
      // A sipariş's ozalit walks its own step machine (goruldu →
      // tasarimci_onay → matbaa_onay), but the click, the stamps and the
      // sheet it writes are the project pipeline's. expectedVersion carries
      // the order's optimistic lock so a second signer can't be silently
      // overwritten — the same guard TalepSignDialog uses.
      const updated = orderScoped
        ? await api.advanceOrderRequest(order.id, {
          expectedVersion: order.version ?? null,
          ...(routeOverride ? { route: routeOverride } : {}),
        })
        : rejectContext
          ? await api.rejectProject(project.id, rejectContext.reason, [], rejectContext.target)
          : await api.advanceProject(project.id)
      await persistAfterStep(payload, { catalog: !authoringOrderOzalit })
      if (!orderScoped) updateOne(updated)
      toast.success(
        rejectContext ? 'Reddedildi, matbaaya yeniden gönderildi.'
          // The designer's own request step names what it just asked for —
          // "Ozalit onaya gönderildi" would describe the round that hasn't
          // been printed yet, and says nothing at all about the Ekran Onayı
          // route this same button can take on a resubmit.
          : authoringOrderOzalit
            ? routeOverride === 'ekran_onay'
              ? 'Ekran onayı istendi, ekip liderine gönderildi.'
              : 'Ozalit istendi, matbaaya gönderildi.'
            : variant.advanceToast(project),
      )
      // The sipariş's ozalit request is where the designer's work actually
      // leaves their desk (the checks step before it is only half a turn), so
      // it celebrates even though the project pipeline's ozalit send doesn't.
      if (!rejectContext && (variant.celebrateOnAdvance || authoringOrderOzalit)) celebrate()
      onDone?.(updated)
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally { setBusy(false) }
  }

  async function handleApprove() {
    if (!project) return
    // The approving leader can still edit this sheet, so a legacy form that
    // was saved blank before this rule existed gets fixed here rather than
    // approved as-is.
    if (!requiredFilled()) return
    setBusy(true)
    try {
      // Stamp the real approver at the moment approval actually happens —
      // this is the only point where "onaylayanKisi" should get a value.
      const approvedForm = { ...form, onaylayanKisi: user?.name ?? '' }
      // matbaa_onay is the sipariş's ozalit_onay: multi-party, leader-first,
      // and it rides the same /advance route one vote at a time — so a click
      // here doesn't always complete the round (see the toast below).
      const updated = orderScoped
        ? await api.advanceOrderRequest(order.id, { expectedVersion: order.version ?? null })
        : await api.approveProject(project.id)
      await persistAfterStep(approvedForm)
      if (!orderScoped) updateOne(updated)
      toast.success(
        !orderScoped ? 'Onaylandı, proje üretime alındı.'
          : updated.status === order.status ? 'Onayınız kaydedildi, diğer onaylar bekleniyor.'
            : 'Ozalit onaylandı, baskı onay formuna gönderildi.',
      )
      onDone?.(updated)
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally { setBusy(false) }
  }

  /**
   * Baskı Onayı dual-approval, maker half: saves the form as-is and marks it
   * "hazırlandı" — this does NOT advance the project. It stays at baski_onay
   * until a different team leader approves (handleApprove above, once
   * `baski_onay_prepared` is true).
   */
  async function handlePrepareBaskiOnay() {
    if (!project) return
    if (!requiredFilled()) return
    setBusy(true)
    try {
      const updated = await api.prepareBaskiOnay(project.id)
      await persistAfterStep(form)
      updateOne(updated)
      toast.success('Baskı onay formu hazırlandı, başka bir ekip liderinin onayı bekleniyor.')
      onDone?.(updated)
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally { setBusy(false) }
  }

  async function handleSave() {
    if (!project || busy) return
    // Applies to the plain save too: a draft parked with a blank ADET /
    // BASIM YERİ is exactly what the next reader picks up and sends on.
    if (!requiredFilled()) return
    // Unlike every other handler here (handleAdvance/handleApprove/
    // handlePrepareBaskiOnay), this one used to have no busy guard — a rapid
    // double-click fired handleSave twice before the first call's await
    // chain finished and closed the dialog, each producing its own
    // notifyDemoEdit call and its own Geçmiş row for what was one save.
    setBusy(true)
    try {
      const notify = notifyOnSave && (
        // A sipariş's correction goes to its own route, which writes the
        // snapshot inside the transaction that authorizes the edit — same
        // contract, same reason, as the project's (migration 053).
        orderScoped ? (id, sheet) => api.notifyOrderOzalitEdit(id, sheet)
          : variant.kind === 'demo' ? api.notifyDemoEdit
            : variant.kind === 'ozalit' ? api.notifyOzalitEdit
              : null
      )
      if (notify) {
        // Correcting an already-sent round. NOTHING is written until the
        // server has authorized it: the route inserts the snapshot inside
        // the same transaction as computeDemoEdit/computeOzalitEdit.
        //
        // This used to save the sheet through POST /demos first and only
        // then call notify, catching the refusal as "kaydedildi ama matbaa
        // bilgilendirilemedi". That message was wrong about which half
        // failed — the edit was live, and the matbaa (who had meanwhile hit
        // "İşlemi Başlatın") went on working from the sheet they started
        // while everyone else saw the corrected one, with no timeline row
        // and no notification, because this very call is what writes both.
        let updated
        try {
          updated = await notify(scopeId, { attempt: writeAttempt, payload: snapshotPayload(form) })
        } catch (err) {
          // Re-read the project so the stale "Gönderilen ... Düzenleyin"
          // button this save came from gives way to "Değişiklik İsteyin".
          // The sipariş's own row is refreshed by its parent's onDone
          // instead — there's no orders store to update in place.
          if (!orderScoped) {
            try { updateOne(await api.getProject(project.id)) } catch { /* the error below is the point */ }
          }
          toast.error(err.message || 'Form güncellenemedi.')
          return
        }
        saveForm(variant, scopeId, form, customRows, selectedComponents)
        await persistCatalogEdits()
        if (!orderScoped) updateOne(updated)
        // The sipariş has no store to write through — hand the fresh row back
        // so the page that opened this dialog re-renders on it.
        if (orderScoped) onDone?.(updated)
        toast.success(`${variant.title} güncellendi, matbaa bilgilendirildi.`)
      } else if (mode === 'view') {
        // Plain viewer ("Demo Formu" / "Ozalit Formu" / "Baskı Onay Formu"
        // buttons) edits are personal — localStorage only. Nothing is written
        // to the snapshot server, so the printer keeps working from the
        // originally sent sheet. To push a change to the printer, use the
        // explicit "Gönderilen Demoyu Düzenleyin" / "Gönderilen Ozaliti
        // Düzenleyin" button (notifyOnSave), which logs a history row and
        // notifies the matbaa. Ürün Bilgileri catalog edits are skipped here
        // for the same reason — they're shared data the printer reads from,
        // and a personal draft shouldn't leak into them.
        saveForm(variant, scopeId, form, customRows, selectedComponents)
        toast.success('Taslak kaydedildi.')
      } else {
        // Compose / approve / etc.: existing silent save path (draft on
        // server, no history row, no push).
        saveForm(variant, scopeId, form, customRows, selectedComponents)
        await persistServerSnapshot(writeAttempt, form)
        await persistCatalogEdits()
        toast.success(variant.saveToast)
      }
      onOpenChange(false)
    } finally { setBusy(false) }
  }

  function handlePrint() {
    if (!project) return
    // A printout is the sheet leaving the app — same bar as sending it.
    if (!readOnly && !requiredFilled()) return
    if (!readOnly) {
      saveForm(variant, scopeId, form, customRows, selectedComponents)
      persistCatalogEdits()
    }
    openMultiPrint({ form, customRows, project, attemptNo: shownAttemptNo, kind: variant.kind, selectedComponents })
  }

  if (!project) return null

  const hasCatalog = catalogComponents.length > 0
  // Demo: system-driven fields must never be editable; Ozalit: they follow readOnly.
  const systemRowReadOnly = variant.systemFieldsEditable ? readOnly : true
  // Parça blocks replace the single İŞİN ADI + custom-rows body: with them on
  // the sheet there is no one job name for the künye to carry, since each
  // block names its own.
  const showsComponentCards = hasCatalog && selectedComponents.length > 0

  /* The fixed rows — the ones the form always carries, whoever filled it in:
     stamps the form writes about itself (who asked, when, who delivered, who
     approved) plus the fields the künye always names. Rows, not a block: they
     read as part of the same continuous sheet as everything above them, and
     the caller decides where in it they land. */
  const fixedKunyeRows = (
    <>
      {/* ADET — dedicated field on the Baskı Onay Formu, auto-filled from a
          live sipariş order or the borrowed ozalit sheet (see the load
          effect); the leader can still correct it. */}
      {variant.adetField && (
        <SheetRow
          label={variant.adetLabel}
          name={variant.adetField}
          value={form[variant.adetField] ?? ''}
          onChange={handleChange}
          readOnly={readOnly}
          required
        />
      )}
      {/* İSTEM rows are shown to every role — the matbaa needs to know who
          requested the demo/ozalit and when, not just its own delivery stamp. */}
      <SheetRow label={variant.dateLabel} name={variant.dateField} value={form[variant.dateField]} onChange={handleChange} readOnly={systemRowReadOnly} />
      {/* BASIM YERİ — right before HAZIRLAYAN, per the feature ask. */}
      {variant.locationField && (
        <SheetRow
          label={variant.locationLabel}
          name={variant.locationField}
          value={form[variant.locationField] ?? ''}
          onChange={handleChange}
          readOnly={readOnly}
          required
        />
      )}
      <SheetRow label={variant.personLabel} name={variant.personField} value={form[variant.personField]} onChange={handleChange} readOnly />
      {/* Blank until handleAdvance stamps them at the moment of teslimat. */}
      {(user?.role === 'printer' || form.teslimTarihi || form.teslimEdenKisi) && (
        <>
          <SheetRow label="TESLİM TARİHİ" name="teslimTarihi" value={form.teslimTarihi ?? ''} onChange={handleChange} readOnly={systemRowReadOnly} />
          <SheetRow label="TESLİM EDEN KİŞİ" name="teslimEdenKisi" value={form.teslimEdenKisi ?? ''} onChange={handleChange} readOnly />
        </>
      )}
      {form.matbaaYetkilisi && <SheetRow label="MATBAA YETKİLİSİ" value={form.matbaaYetkilisi} readOnly />}
      {form.onaylayanKisi && <SheetRow label="ONAYLAYAN KİŞİ" value={form.onaylayanKisi} readOnly />}
    </>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Radix focuses the first focusable element on open — here that's the
        // İŞİN ADI input, and browsers render focused-input text as selected,
        // so the sheet opened with the title looking "highlighted". Keep
        // focus on the dialog itself instead.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn('max-w-2xl', DIALOG_MOBILE_SHEET)}>
        {/* The sheet below carries its own title block, so on paper this
            would print the form's name twice. */}
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {variant.title}
            {readOnly && <span className="ml-1 text-xs font-normal text-muted-foreground">({shownAttemptNo}. {variant.attemptWord})</span>}
          </DialogTitle>
        </DialogHeader>

        {/* The designer's ozalit request (migration 054). The checks are
            already signed off one step back; this sheet is the ask itself, so
            say what pressing send does — and name the second route when the
            order has bounced back and both are on offer. */}
        {authoringOrderOzalit && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-semibold text-foreground">Ozalit isteği</p>
            <p className="mt-0.5 text-muted-foreground">
              Kontrolleriniz kaydedildi. Formu gözden geçirin, gerekirse düzeltin ve gönderin — matbaa
              ozaliti bu formdan basacak.
              {order?.last_reject_type === 'designer'
                && ' Revize sonrası olduğu için, fiziksel ozalit yerine ekip liderinden ekran onayı da isteyebilirsiniz.'}
            </p>
          </div>
        )}

        {/* Reject-to-matbaa review (ApprovalDialog hand-off) — the leader is
            about to send this sheet back to matbaa for redelivery; make that
            explicit and show the reason they just typed. */}
        {rejectContext && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-semibold text-destructive">Matbaaya yeniden gönderilecek</p>
            <p className="mt-0.5 text-muted-foreground">
              Göndermeden önce formu gözden geçirin. Red sebebi: <span className="italic">"{rejectContext.reason}"</span>
            </p>
          </div>
        )}

        {/* Migration 049 — only rendered on the dedicated "Gönderilen
            Demoyu/Ozaliti Düzenleyin" path (notifyOnSave), diffed against
            what the matbaa currently has. Empty diff (nothing edited yet)
            stays hidden rather than showing an empty box. */}
        {changeSummary && changeSummary.length > 0 && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <Pencil className="h-3 w-3 text-primary" />
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Değişiklikler
              </p>
              <span className="ml-auto rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                {changeSummary.length}
              </span>
            </div>
            <ul className="space-y-1">
              {changeSummary.map((c, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-md border border-black/5 bg-white px-2.5 py-1.5 text-[13px] shadow-sm"
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                      c.status === 'removed' && 'bg-rose-100 text-rose-600',
                      c.status === 'added' && 'bg-emerald-100 text-emerald-600',
                      c.status === 'changed' && 'bg-amber-100 text-amber-600',
                    )}
                  >
                    {c.status === 'removed' && <Minus className="h-2.5 w-2.5" />}
                    {c.status === 'added' && <Plus className="h-2.5 w-2.5" />}
                    {c.status === 'changed' && <Pencil className="h-2.5 w-2.5" />}
                  </span>
                  <span className="min-w-0 shrink-0 font-semibold text-foreground/80">{c.label}</span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5 text-right">
                    {c.status === 'changed' && (
                      <span className="truncate rounded bg-rose-50 px-1.5 py-0.5 text-rose-600 line-through decoration-rose-400">
                        {c.oldValue}
                      </span>
                    )}
                    {c.status === 'changed' && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                    {c.status !== 'removed' && (
                      <span className="truncate rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">
                        {c.newValue}
                      </span>
                    )}
                    {c.status === 'removed' && (
                      <span className="truncate rounded bg-rose-50 px-1.5 py-0.5 text-rose-600 line-through decoration-rose-400">
                        {c.oldValue}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* The dialog IS the form — the same document openMultiPrint() puts
            on paper, rendered live: title block, the spec (added rows or a
            block per parça), then the künye as the foot. Editing and read-only
            share the layout; only the fields switch between input and plain
            text, so a sheet nobody can edit reads as a document rather than a
            page of dead inputs. */}
        <FormSheet>
          <FormSheetHead
            title={variant.title}
            subtitle={project.title}
            attemptLabel={`${shownAttemptNo}. ${variant.attemptUpper}`}
            icon={FileText}
          />

          {/* One continuous sheet: the job name, the rows the user added, then
              the fixed rows as its foot — all on the same block so every rule
              between them is the same hairline and the form reads as one
              document, not as sections stacked on top of each other. */}
          {!showsComponentCards && (
            <FormSheetBlock className="bg-muted/10">
              <SheetRow label="İŞİN ADI" name="isinAdi" value={form.isinAdi} onChange={handleChange} readOnly={systemRowReadOnly} />
              {customRows.map((r, i) => (
                <SheetSpecRow
                  key={r.id}
                  label={r.label}
                  value={r.value}
                  onLabelChange={(v) => updateCustomRow(r.id, 'label', v)}
                  onValueChange={(v) => updateCustomRow(r.id, 'value', v)}
                  onRemove={() => removeCustomRow(r.id)}
                  onMoveUp={customRows.length > 1 && i > 0 ? () => moveCustomRow(r.id, -1) : null}
                  onMoveDown={customRows.length > 1 && i < customRows.length - 1 ? () => moveCustomRow(r.id, 1) : null}
                  readOnly={readOnly}
                />
              ))}
              {!readOnly && <SheetAddRow onClick={addCustomRow} />}
              {fixedKunyeRows}
            </FormSheetBlock>
          )}

          {/* Per-component picker — only when the project has product info.
              Pure editing control: it never goes on paper. */}
          {hasCatalog && !readOnly && (
            <div className="border-b bg-muted/20 px-4 py-3 print:hidden">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Parçalar (ürün bilgilerinden)
                </p>
                <div className="flex items-center gap-3 text-[11px]">
                  <button
                    type="button"
                    onClick={selectAllComponents}
                    className="font-semibold text-primary hover:underline"
                  >
                    Tümünü Seç
                  </button>
                  <button
                    type="button"
                    onClick={clearComponents}
                    className="font-semibold text-muted-foreground hover:underline"
                  >
                    Hiçbiri
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {catalogComponents.map((c) => {
                  const checked = selectedComponents.some((s) => s.id === c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleComponent(c.id)}
                      className={`flex items-center gap-2 rounded-md border bg-white px-2.5 py-1.5 text-left text-xs transition active:scale-[0.99] ${
                        checked ? 'border-primary/50 ring-1 ring-primary/30' : 'hover:border-primary/30'
                      }`}
                    >
                      {checked
                        ? <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
                        : <Square className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      <span className="min-w-0 flex-1 truncate font-semibold uppercase tracking-wide">{c.component}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{c.rows.length} satır</span>
                    </button>
                  )
                })}
              </div>
              {selectedComponents.length > 0 && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Yazdır / Gönder dediğinizde <strong>{selectedComponents.length}</strong> ayrı form oluşturulur, her parça kendi sayfasında.
                </p>
              )}
            </div>
          )}

          {/* Selected parçalar, stacked as blocks of the same sheet — each one
              prints as its own page. Edits here flow back to Ürün Bilgileri on
              save. With no catalog, or nothing selected, there are no parça
              blocks and the added rows above are the sheet's whole spec. */}
          {showsComponentCards &&
            selectedComponents.map((c) => (
              <div key={c.id} className="border-b last:border-b-0">
                <FormSheetBlockTitle>{c.component}</FormSheetBlockTitle>
                <FormSheetBlock className="border-b-0">
                  {(c.rows ?? []).length === 0 && readOnly && (
                    <p className="py-2 text-center text-[11px] text-muted-foreground">Satır yok.</p>
                  )}
                  {(c.rows ?? []).map((r, i) => (
                    <SheetSpecRow
                      key={r.id}
                      label={r.label}
                      value={r.value}
                      onLabelChange={(v) => updateComponentRow(c.id, r.id, 'label', v)}
                      onValueChange={(v) => updateComponentRow(c.id, r.id, 'value', v)}
                      onRemove={() => removeComponentRow(c.id, r.id)}
                      onMoveUp={(c.rows ?? []).length > 1 && i > 0 ? () => moveComponentRow(c.id, r.id, -1) : null}
                      onMoveDown={(c.rows ?? []).length > 1 && i < (c.rows ?? []).length - 1 ? () => moveComponentRow(c.id, r.id, 1) : null}
                      readOnly={readOnly}
                    />
                  ))}
                  {!readOnly && <SheetAddRow onClick={() => addComponentRow(c.id)} />}
                </FormSheetBlock>
              </div>
            ))}

          {showsComponentCards && !readOnly && (
            <p className="px-4 py-2 text-[10px] text-muted-foreground print:hidden">
              Buradaki düzenlemeler Ürün Bilgileri'ne de kaydedilir.
            </p>
          )}

          {/* The form's foot. Without parça blocks these rows already close
              the single block above — putting them in a block of their own
              there would cut the sheet in two, which is the one thing this
              form must not do. With parça blocks there is no such block to
              close, so they get one here. */}
          {showsComponentCards && (
            <FormSheetBlock className="bg-muted/10">{fixedKunyeRows}</FormSheetBlock>
          )}
        </FormSheet>

        {/* Ozalit receipt gate — the approve below stays disabled until the
            proof is acknowledged. The confirm is inline (a second click on the
            same spot) rather than a nested dialog. */}
        {isOzalitApproval && (
          ozalitReceived ? (
            ozalitAwaitingLeader ? (
              <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                <Check className="h-4 w-4 shrink-0" />
                <span>
                  Ozalit teslim alındı{round.receivedBy ? `, ${round.receivedBy}` : ''}.
                  Onay sırası ekip liderinde, o onayladıktan sonra onaylayabilirsiniz.
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
                <Check className="h-4 w-4 shrink-0" />
                <span>
                  Ozalit teslim alındı{round.receivedBy ? `, ${round.receivedBy}` : ''}. Onaylayabilirsiniz.
                </span>
              </div>
            )
          ) : (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <p>
                Onaydan önce ozalit teslim alınıp <strong>"Teslim Alındı"</strong> olarak
                işaretlenmelidir (atanmış tasarımcı veya ekip lideri).
              </p>
              {canAckOzalit && (
                confirmReceive ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium">Ozaliti teslim aldınız mı?</span>
                    <Button type="button" size="sm" variant="success" onClick={handleReceiveOzalit} disabled={receiving}>
                      <Check className="h-4 w-4" />
                      {receiving ? 'İşleniyor…' : 'Evet, teslim aldım'}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmReceive(false)} disabled={receiving}>
                      Vazgeç
                    </Button>
                  </div>
                ) : (
                  <Button type="button" size="sm" variant="outline" onClick={() => setConfirmReceive(true)}>
                    <Check className="h-4 w-4" />
                    Teslim Alındı olarak işaretle
                  </Button>
                )
              )}
            </div>
          )
        )}

        {/* Baskı Onayı dual-approval banner — mirrors the ozalit receipt gate's
            inline copy above. Prepared: names who did it (everyone, including
            the preparer, sees the same Onayla button below — the server is
            what actually refuses a same-person approve, see handleApprove /
            computeApproval). Not yet prepared: nudges toward Hazırla. */}
        {isBaskiOnayApproval && (
          baskiOnayPrepared ? (
            <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
              <Check className="h-4 w-4 shrink-0" />
              <span>
                Baskı onay formunu {project?.baski_onay_prepared_by_name ?? 'bir ekip lideri'} hazırladı.
                Formu hazırlayandan başka bir ekip lideri onaylamalıdır.
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <FileText className="h-4 w-4 shrink-0" />
              <span>Önce formu gözden geçirip "Hazırla ve Onaya Gönder" ile onaya açın.</span>
            </div>
          )
        )}

        {/* Matbaa "Başladım" gate (migration 048) — tells the leader/designer
            why this form suddenly stopped taking edits, and where to go
            instead. Only shown to the audience who'd otherwise expect to
            edit; the printer/team_leader-only variants already lock via
            isReadOnly for role reasons and don't need this. */}
        {/* canRequestDemoChange/canRequestOzalitChange are team-leader-only
            (same follow-up as cancel/edit-notify above) — the designer no
            longer has a "Değişiklik İste" button to be pointed at. */}
        {lockedByStart && user?.role === 'team_leader' && (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <FileText className="h-4 w-4 shrink-0" />
            <span>
              Matbaa {variant.kind === 'demo' ? 'demo' : 'ozalit'} çalışmasına başladı.
              Değişiklik yapmak için "Değişiklik İste" düğmesini kullanın.
            </span>
          </div>
        )}
        {lockedByStart && user?.role === 'designer' && (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <FileText className="h-4 w-4 shrink-0" />
            <span>
              Matbaa {variant.kind === 'demo' ? 'demo' : 'ozalit'} çalışmasına başladı.
              Değişiklik için ekip liderine bildirin.
            </span>
          </div>
        )}

        {/* Migration 049 (+ team-leader-only follow-up): the matbaa accepted
            a change request and is waiting on the fix. Only the team leader
            can act on it (canEditSentDemoRequest/canEditSentOzalitRequest),
            so only they get pointed at the button — telling a designer to
            click something they don't have would just be confusing. */}
        {lockedByFixPending && user?.role === 'team_leader' && (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <Pencil className="h-4 w-4 shrink-0" />
            <span>
              Matbaa değişiklik talebinizi kabul etti ve düzeltmenizi bekliyor.
              Düzeltmeyi yapmak için "{variant.kind === 'demo' ? 'Gönderilen Demoyu Düzenleyin' : 'Gönderilen Ozaliti Düzenleyin'}" düğmesini kullanın.
            </span>
          </div>
        )}
        {lockedByFixPending && user?.role === 'designer' && (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <Pencil className="h-4 w-4 shrink-0" />
            <span>
              Matbaa değişiklik talebinizi kabul etti, ekip lideri düzeltmeyi bekliyor.
            </span>
          </div>
        )}

        {/* Printer reviews the spec sheet before marking demo/ozalit started —
            İşlemi Başlatın below locks the leader/designer's free cancel/edit
            behind a change-request (migration 048), so this warns them here
            rather than only after the fact. */}
        {onStartWork && (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              İşlemi başlattığınızda, ekip lideri veya tasarımcının iptal ya da düzenleme yapması
              sizin onayınızı gerektiren bir değişiklik talebine dönüşür.
            </span>
          </div>
        )}

        {/* Says which required field is still blank, right above the buttons
            it disables — the red row wash upstream marks the field itself. */}
        {missingRequired.length > 0 && !readOnly && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <FileText className="h-4 w-4 shrink-0" />
            <span>{missingRequired.join(' ve ')} boş bırakılamaz. Formu göndermeden önce doldurun.</span>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {readOnly ? 'Kapatın' : 'İptal'}
          </Button>
          {printable && (
            <Button type="button" variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4" />
              Yazdırın
            </Button>
          )}
          {mode === 'view' && user?.role !== 'printer' && (!variant.saveRequiresEditable || !readOnly) && (
            <Button disabled={busy || missingRequired.length > 0} onClick={handleSave}>{busy ? 'Kaydediliyor…' : 'Kaydedin'}</Button>
          )}
          {mode === 'view' && onStartWork && (
            <Button variant="success" disabled={startingWork} onClick={onStartWork}>
              <CheckCircle2 className="h-4 w-4" />
              {startingWork ? 'İşleniyor…' : 'İşlemi Başlatın'}
            </Button>
          )}
          {/* Resubmit after a reject-to-designer: the same sheet can go to the
              matbaa for another physical ozalit (the primary button) or
              straight to the team leader as a digital Ekran Onayı. Only
              offered once the order has actually bounced back — a first
              request always takes the matbaa route. */}
          {mode === 'advance' && authoringOrderOzalit && order?.last_reject_type === 'designer' && (
            <Button
              type="button"
              variant="outline"
              disabled={busy || missingRequired.length > 0}
              onClick={() => handleAdvance('ekran_onay')}
            >
              {busy ? 'Gönderiliyor…' : 'Ekran Onayı İsteyin'}
            </Button>
          )}
          {mode === 'advance' && (
            <Button
              disabled={busy || missingRequired.length > 0}
              onClick={() => handleAdvance(authoringOrderOzalit && order?.last_reject_type === 'designer' ? 'tasarimci_onay' : null)}
              variant={rejectContext ? 'destructive' : 'default'}
            >
              <Send className="h-4 w-4" />
              {busy
                ? 'Gönderiliyor…'
                : rejectContext ? 'Reddedin ve Gönderin'
                  : authoringOrderOzalit ? 'Ozalit İsteyin'
                    : variant.advanceLabel(user)}
            </Button>
          )}
          {isBaskiOnayApproval && !baskiOnayPrepared && (
            <Button disabled={busy || missingRequired.length > 0} onClick={handlePrepareBaskiOnay}>
              <Send className="h-4 w-4" />
              {busy ? 'Kaydediliyor…' : 'Hazırlayın ve Onaya Gönderin'}
            </Button>
          )}
          {mode === 'approve' && (!isBaskiOnayApproval || baskiOnayPrepared) && (
            <Button variant="success" disabled={busy || needsOzalitReceive || ozalitAwaitingLeader || missingRequired.length > 0} onClick={handleApprove}>
              <Check className="h-4 w-4" />
              {busy ? 'İşleniyor…' : 'Onaylayın'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
