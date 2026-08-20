import { useEffect, useMemo, useState } from 'react'
import { Check, CheckSquare, FileText, Plus, Printer, Send, Square, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { useAuth } from '@/hooks/useAuth'
import { useProjectsStore } from '@/hooks/useProjectsStore'
import { useDesignerCelebration } from '@/hooks/useCelebration'
import { getComponentsForProject, getComponentRows, primeProductInfoCache, saveEditedComponents } from '@/data/productCatalog'
import { printSpecSheets, buildSpecRows } from '@/lib/specPrint'
import { hasSpecContent, specWithDemoFallback } from '@/lib/spec-seed'
import { buildAdetRows, loadOrderAdet } from '@/data/orderAdet'
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
 */
async function fetchServerSnapshot(api, variant, projectId, attempt) {
  try {
    const all = await api.listDemos()
    const mine = (all ?? []).filter(
      (d) => d.project_id === projectId && (d.kind ?? 'demo') === variant.kind &&
             (attempt == null || d.attempt === attempt),
    )
    if (mine.length === 0) return null
    // listDemos is ordered newest-first; take the most recent row.
    const row = mine[0]
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
    return parseSaved(variant, JSON.stringify(payload ?? {}))
  } catch {
    return null
  }
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
 */
export async function stampSpecSignature(variantName, project, patch) {
  const variant = VARIANTS[variantName]
  if (!variant || !project?.id) return
  const attempt = (project[variant.attemptField] ?? 0) + 1
  // Same precedence as the dialog's own load: this attempt's snapshot is
  // authoritative; the project-level blob is a spec-only fallback with the
  // previous round's stamps stripped.
  // The server sources matter most here: this can run on a machine that never
  // opened the form, where localStorage holds nothing at all. Without the
  // server fallbacks the signature would be written onto an otherwise empty
  // snapshot and take the spec's place.
  const existing =
    (await fetchServerSnapshot(api, variant, project.id, attempt)) ??
    loadSnapshot(variant, project.id, attempt) ??
    stripStamps(loadSaved(variant, project.id)) ??
    stripStamps(await fetchServerSnapshot(api, variant, project.id, null)) ??
    { form: {}, customRows: [], selectedComponents: null }
  const form = { ...(existing.form ?? {}), ...patch }
  const customRows = existing.customRows ?? []
  const selectedComponents = existing.selectedComponents ?? null
  saveForm(variant, project.id, form, customRows, selectedComponents)
  saveSnapshot(variant, project.id, attempt, form, customRows, selectedComponents)
  try {
    await api.createDemo({
      project_id: project.id,
      kind: variant.kind,
      attempt,
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

/* ------------------------------------------------------------------ */
/*  Print sheet                                                       */
/* ------------------------------------------------------------------ */

/**
 * Print every selected parça in ONE job (one classic sheet per parça, page
 * break between). If nothing is selected, prints the single custom-row sheet.
 * Uses the shared specPrint helper so Dökümanlar and this dialog stay in sync.
 */
function openMultiPrint({ form, customRows, project, attemptNo, kind, selectedComponents }) {
  const designerNames = (project?.assignees ?? []).map((a) => a.name).join(', ') || project?.assigned_name || ''
  const attemptLabel = `${attemptNo}. ${kind === 'ozalit' ? 'OZALİT' : kind === 'baski_onay' ? 'BASKI ONAY' : 'DEMO'}`
  const selected = (selectedComponents ?? []).filter(Boolean)
  const comps = selected.length > 0
    ? selected
    : [{ component: form.isinAdi || project?.title || '', rows: (customRows ?? []).filter((r) => r.label) }]
  const sheets = comps.map((c) => ({
    // Each sheet's header is its own parça — otherwise the KUTU sheet would be
    // titled with the book's name.
    title: c.component || project?.title || '',
    attemptLabel,
    rows: buildSpecRows({ component: c, form, kind }),
    designerNames,
    onaylayanKisi: form?.onaylayanKisi ?? '',
    matbaaYetkilisi: form?.matbaaYetkilisi ?? '',
  }))
  const ok = printSpecSheets(sheets, { docTitle: `${attemptLabel} — ${project?.title ?? ''}` })
  if (!ok) toast.error('Pop-up engelleyiciyi kontrol edin.')
}

/* ------------------------------------------------------------------ */
/*  Small presentational pieces                                       */
/* ------------------------------------------------------------------ */

function Row({ label, name, value, onChange, readOnly }) {
  return (
    <div className="grid grid-cols-[1fr_auto_2fr] items-center border-b last:border-b-0">
      <span className="py-1.5 pr-3 text-[13px] font-semibold uppercase tracking-wide text-foreground">
        {label}
      </span>
      <span className="px-2 py-1.5 text-sm font-bold">:</span>
      <Input
        name={name}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        className="h-8 rounded-none border-0 border-l px-2 py-1 text-sm shadow-none focus-visible:ring-0 read-only:bg-transparent read-only:cursor-default"
      />
    </div>
  )
}

function CustomRow({ id, label, value, onChange, onRemove, readOnly }) {
  return (
    <div className="grid grid-cols-[1fr_auto_2fr] items-center border-b last:border-b-0">
      <Input
        value={label}
        onChange={(e) => onChange(id, 'label', e.target.value)}
        placeholder="Alan adı"
        readOnly={readOnly}
        className="h-8 rounded-none border-0 bg-white px-2 py-1 text-[13px] font-semibold uppercase tracking-wide shadow-none placeholder:normal-case placeholder:tracking-normal placeholder:font-normal focus-visible:ring-0 read-only:cursor-default"
      />
      <span className="px-2 py-1.5 text-sm font-bold">:</span>
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => onChange(id, 'value', e.target.value)}
          readOnly={readOnly}
          className="h-8 rounded-none border-0 border-l bg-white pr-7 px-2 py-1 text-sm shadow-none focus-visible:ring-0 read-only:bg-transparent read-only:cursor-default"
        />
        {!readOnly && (
          <button
            type="button"
            onClick={() => onRemove(id)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function SigBox({ role, name }) {
  return (
    <div className="flex flex-1 flex-col px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{role}</p>
      <div className="mt-3 flex min-h-[2.75rem] items-end border-b border-foreground/25 pb-0.5">
        {name && (
          <span style={{ fontFamily: "'Alex Brush', cursive", fontSize: '1.35rem', color: 'hsl(325 21% 20% / 0.8)' }}>
            {name}
          </span>
        )}
      </div>
      <p className="mt-1 text-center text-[10px] text-muted-foreground">İmza</p>
    </div>
  )
}

/* Read-only definition row (label : value). Wraps long values (e.g. the
   TUŞLAR EBAT list) instead of truncating them like a single-line input. */
function ClassicRow({ label, value }) {
  return (
    <div className="grid grid-cols-[minmax(6rem,38%)_auto_1fr] items-start gap-2 border-b py-1.5 last:border-b-0">
      <span className="pt-px text-[11px] font-semibold uppercase leading-snug tracking-wide text-muted-foreground">{label}</span>
      <span className="text-xs font-bold text-muted-foreground">:</span>
      <span className="min-w-0 whitespace-pre-wrap break-words text-[13px] leading-snug text-foreground">{value || '—'}</span>
    </div>
  )
}

/* One parça rendered in the classic single-column format (header + attempt +
   İŞİN ADI + spec rows + system fields + signatures). Read-only. In view /
   history mode we stack one of these per selected parça, mirroring the printed
   output (each parça is its own sheet with its own signature block). */
function ClassicSheet({ project, component, attemptNo, variant, form, user }) {
  const rows = component.rows ?? []
  const designerNames = (project?.assignees ?? []).map((a) => a.name).join(', ') || project?.assigned_name || ''
  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <div className="border-b px-4 py-3 text-center">
        <h2 className="text-base font-bold uppercase tracking-widest text-foreground">{component.component || project.title}</h2>
      </div>
      <div className="border-b px-4 py-2 text-right">
        <span className="text-sm font-bold">{attemptNo}. {variant.attemptUpper}</span>
      </div>
      <div className="border-b px-4 py-1">
        <ClassicRow label="İŞİN ADI" value={component.component} />
        {variant.adetField && <ClassicRow label={variant.adetLabel} value={form[variant.adetField]} />}
        {rows.map((r) => (
          <ClassicRow key={r.id} label={r.label} value={r.value} />
        ))}
      </div>
      <div className="border-b px-4 py-1">
        {/* Who asked for this sheet, and when — shown to EVERY role including
            the matbaa, who otherwise had no way to see how long the job had
            been waiting (the teslim rows used to replace these). */}
        <ClassicRow label={variant.dateLabel} value={form[variant.dateField]} />
        {variant.locationField && <ClassicRow label={variant.locationLabel} value={form[variant.locationField]} />}
        <ClassicRow label={variant.personLabel} value={form[variant.personField]} />
        {/* Delivery rows. Left BLANK until the matbaa actually advances
            (handleAdvance stamps them) — same rule as onaylayanKisi below.
            They used to fall back to the İSTEM date/person, which printed the
            requester's date under a "TESLİM TARİHİ" label before anything had
            been delivered. */}
        {(user?.role === 'printer' || form.teslimTarihi || form.teslimEdenKisi) && (
          <>
            <ClassicRow label="TESLİM TARİHİ" value={form.teslimTarihi ?? ''} />
            <ClassicRow label="TESLİM EDEN KİŞİ" value={form.teslimEdenKisi ?? ''} />
          </>
        )}
        {form.matbaaYetkilisi && <ClassicRow label="MATBAA YETKİLİSİ" value={form.matbaaYetkilisi} />}
        {form.onaylayanKisi && <ClassicRow label="ONAYLAYAN KİŞİ" value={form.onaylayanKisi} />}
      </div>
      <div className="flex divide-x">
        <SigBox role="Tasarımcı" name={designerNames} />
        {form.matbaaYetkilisi && <SigBox role="Matbaa Yetkilisi" name={form.matbaaYetkilisi} />}
        {form.onaylayanKisi && <SigBox role="Ekip Lideri / Onaylayan" name={form.onaylayanKisi} />}
      </div>
    </div>
  )
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
 */
export default function SpecFormDialog({ variant: variantName = 'demo', open, onOpenChange, project, mode, onDone, viewAttempt }) {
  const variant = VARIANTS[variantName]
  const { user } = useAuth()
  const { updateOne } = useProjectsStore()
  const celebrate = useDesignerCelebration()
  const [form, setForm] = useState(() => emptyForm(variant, project, user))
  const [customRows, setCustomRows] = useState([])
  const [selectedComponents, setSelectedComponents] = useState([]) // [{ id, component, rows }]
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
  const lockedByStart = mode === 'view' && (
    (variant.kind === 'demo' && !!project?.demo_started) ||
    (variant.kind === 'ozalit' && !!project?.ozalit_started)
  )
  const readOnly = variant.isReadOnly({ mode, user }) || lockedByStart
  const printable = variant.canPrint({ user, project, readOnly })

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
      if (viewAttempt != null) {
        // History: show the snapshot exactly as it was saved — no auto-fills.
        // Server snapshot first (works on any computer), localStorage fallback.
        const snap =
          (await fetchServerSnapshot(api, variant, project.id, viewAttempt)) ??
          loadSnapshot(variant, project.id, viewAttempt) ??
          loadSaved(variant, project.id)
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
        (await fetchServerSnapshot(api, variant, project.id, attemptNo)) ??
        loadSnapshot(variant, project.id, attemptNo)
      if (cancelled) return
      const carried =
        loadSaved(variant, project.id) ??
        (await fetchServerSnapshot(api, variant, project.id, null))
      if (cancelled) return
      const data = current ?? stripStamps(carried)
      const fresh = emptyForm(variant, project, user)
      if (readOnly || variant.restoreSavedOnEdit) {
        // Read-only viewers (printer, leader) must see the values that were
        // actually saved at submission time — otherwise the form would show
        // today's date and the matbaa's own name as the requester. Layer the
        // saved form back on top so İŞİN ADI, İSTEM TARİHİ and İSTEYEN KİŞİ
        // reflect what was stamped. The teslim/onay stamps come through only
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
        const fromDemo =
          loadSaved(VARIANTS.demo, project.id) ??
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
          loadSaved(fallbackVariant, project.id) ??
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
          const order = loadOrderAdet(project.id)
          adetValue = order?.quantity ? formatNumber(order.quantity) : ''
          if (!adetValue) {
            const idx = savedRows.findIndex((r) => r.label?.toUpperCase().startsWith('ADET'))
            if (idx !== -1) {
              adetValue = savedRows[idx].value
              rowsForCustom = savedRows.filter((_, i) => i !== idx)
            }
          }
        }
        if (adetValue) setForm((f) => ({ ...f, [variant.adetField]: adetValue }))
        setCustomRows(rowsForCustom)
      } else {
        const hasAdet = savedRows.some((r) => r.label?.toUpperCase().startsWith('ADET'))
        setCustomRows(hasAdet ? savedRows : [...buildAdetRows(project.id), ...savedRows])
      }
      // null means never explicitly set — default to all catalog components checked.
      // [] means the user intentionally cleared them — respect that.
      const savedComponents = spec?.selectedComponents ?? null
      setSelectedComponents(savedComponents ?? catalogComponents)
    }

    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id, viewAttempt])

  /* ── Ozalit "Teslim Alındı" gate ──────────────────────────────────────────
   * The ozalit approve is refused server-side until the physical proof has
   * been acknowledged (migration 035), so this dialog — which is where the
   * Onaylar page and the project detail both sign off — has to offer the
   * acknowledgment inline rather than bouncing the user with an error toast.
   * Same shape as ApprovalDialog's demo gate; `receivedLocal` reflects a click
   * made in this session, before the parent re-passes the updated project.
   */
  const isOzalitApproval = mode === 'approve' && variantName === 'ozalit'
  const ozalitReceived = !!project?.ozalit_received || receivedLocal
  const needsOzalitReceive = isOzalitApproval && !ozalitReceived
  const canAckOzalit =
    user?.role === 'team_leader' ||
    (user?.role === 'designer' && (project?.assignees ?? []).some((a) => a.id === user?.id))

  /* ── Ozalit leader-first gate ─────────────────────────────────────────────
   * The second ordering rule on the same approve: a designer counter-signs an
   * ozalit only after a team leader has approved it (computeOzalitOnayApproval
   * refuses otherwise). Nothing for the designer to click here — unlike the
   * receipt gate, they can't open it themselves — so the button is disabled
   * with the reason spelled out.
   */
  const ozalitAwaitingLeader =
    isOzalitApproval && user?.role === 'designer' && !ozalitLeaderApproved(project)

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
  }, [open, project?.id])

  async function handleReceiveOzalit() {
    if (!project) return
    setReceiving(true)
    try {
      const updated = await api.receiveOzalit(project.id)
      updateOne(updated)
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
    mode === 'advance' &&
    user?.role !== 'printer' &&
    DEMO_RESEND_STAGES.has(project?.stage)
  const attemptNo =
    viewAttempt ?? ((project?.[variant.attemptField] ?? 0) + (willResendBump ? 2 : 1))

  /** Mirror the snapshot to the server so any browser can reopen it. */
  function persistServerSnapshot(attempt, data) {
    api.createDemo({
      project_id: project.id,
      kind: variant.kind,
      attempt,
      silent: true,
      payload: {
        ...data,
        _customRows: customRows,
        _selectedComponents: selectedComponents ?? null,
      },
    }).catch(() => { /* localStorage still has it; don't block the flow */ })
  }

  // Write any edits made in the side-by-side parça cards back to Ürün Bilgileri
  // (the shared, server-side catalog) so a change made while requesting a demo
  // updates the product spec everywhere — and records who changed it. No-op in
  // read-only mode or for projects without a catalog.
  async function persistCatalogEdits() {
    if (readOnly || !catalogComponents.length || !selectedComponents?.length) return
    try { await saveEditedComponents(project.id, selectedComponents) } catch { /* non-blocking */ }
  }

  async function handleAdvance() {
    if (!project) return
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
      saveForm(variant, project.id, payload, customRows, selectedComponents)
      saveSnapshot(variant, project.id, attemptNo, payload, customRows, selectedComponents)
      persistServerSnapshot(attemptNo, payload)
      await persistCatalogEdits()
      const updated = await api.advanceProject(project.id)
      updateOne(updated)
      toast.success(variant.advanceToast(project))
      if (variant.celebrateOnAdvance) celebrate()
      onDone?.(updated)
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally { setBusy(false) }
  }

  async function handleApprove() {
    if (!project) return
    setBusy(true)
    try {
      // Stamp the real approver at the moment approval actually happens —
      // this is the only point where "onaylayanKisi" should get a value.
      const approvedForm = { ...form, onaylayanKisi: user?.name ?? '' }
      saveForm(variant, project.id, approvedForm, customRows, selectedComponents)
      saveSnapshot(variant, project.id, attemptNo, approvedForm, customRows, selectedComponents)
      persistServerSnapshot(attemptNo, approvedForm)
      await persistCatalogEdits()
      const updated = await api.approveProject(project.id)
      updateOne(updated)
      toast.success('Onaylandı, proje üretime alındı.')
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
    setBusy(true)
    try {
      saveForm(variant, project.id, form, customRows, selectedComponents)
      saveSnapshot(variant, project.id, attemptNo, form, customRows, selectedComponents)
      persistServerSnapshot(attemptNo, form)
      await persistCatalogEdits()
      const updated = await api.prepareBaskiOnay(project.id)
      updateOne(updated)
      toast.success('Baskı onay formu hazırlandı, başka bir ekip liderinin onayı bekleniyor.')
      onDone?.(updated)
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message || 'İşlem tamamlanamadı.')
    } finally { setBusy(false) }
  }

  async function handleSave() {
    if (!project) return
    saveForm(variant, project.id, form, customRows, selectedComponents)
    persistServerSnapshot(attemptNo, form)
    await persistCatalogEdits()
    toast.success(variant.saveToast)
    onOpenChange(false)
  }

  function handlePrint() {
    if (!project) return
    if (!readOnly) {
      saveForm(variant, project.id, form, customRows, selectedComponents)
      persistCatalogEdits()
    }
    openMultiPrint({ form, customRows, project, attemptNo, kind: variant.kind, selectedComponents })
  }

  if (!project) return null

  const hasCatalog = catalogComponents.length > 0
  // Demo: system-driven fields must never be editable; Ozalit: they follow readOnly.
  const systemRowReadOnly = variant.systemFieldsEditable ? readOnly : true
  // View / history / printer: render each selected parça as its own classic
  // single-column sheet (matches the printout). Editing keeps the side-by-side
  // cards. Falls back to the single sheet when nothing is selected.
  const readOnlyClassic = readOnly && hasCatalog && selectedComponents.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Radix focuses the first focusable element on open — here that's the
        // İŞİN ADI input, and browsers render focused-input text as selected,
        // so the sheet opened with the title looking "highlighted". Keep
        // focus on the dialog itself instead.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn('max-w-2xl', DIALOG_MOBILE_SHEET)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {variant.title}
            {readOnly && <span className="ml-1 text-xs font-normal text-muted-foreground">({attemptNo}. {variant.attemptWord})</span>}
          </DialogTitle>
        </DialogHeader>

        {readOnlyClassic ? (
          <div className="space-y-4">
            {selectedComponents.map((c) => (
              <ClassicSheet
                key={c.id}
                project={project}
                component={c}
                attemptNo={attemptNo}
                variant={variant}
                form={form}
                user={user}
              />
            ))}
          </div>
        ) : (
        <>
        <div className="rounded-lg border bg-white">
          <div className="border-b px-4 py-3 text-center">
            <h2 className="text-base font-bold uppercase tracking-widest text-foreground">{project.title}</h2>
          </div>
          <div className="border-b px-4 py-2 text-right">
            <span className="text-sm font-bold">{attemptNo}. {variant.attemptUpper}</span>
          </div>

          {/* ADET — dedicated top field on the Baskı Onay Formu, auto-filled
              from a live sipariş order or the borrowed ozalit sheet (see the
              load effect); the leader can still correct it. */}
          {variant.adetField && (
            <div className="border-b px-4 py-1">
              <Row
                label={variant.adetLabel}
                name={variant.adetField}
                value={form[variant.adetField] ?? ''}
                onChange={handleChange}
                readOnly={readOnly}
              />
            </div>
          )}

          {/* Per-component picker — only when the project has product info */}
          {hasCatalog && !readOnly && (
            <div className="border-b bg-muted/20 px-4 py-3">
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
                  Yazdır / Gönder dediğinizde <strong>{selectedComponents.length}</strong> ayrı form oluşturulur, her parça kendi imza bloğuyla birlikte.
                </p>
              )}
            </div>
          )}

          {/* Selected parçalar, auto-filled side by side (scrolls horizontally).
              Edits here flow back to Ürün Bilgileri on save. When the project
              has a catalog but nothing is selected, or has no catalog at all,
              we fall back to the single İŞİN ADI + custom-rows sheet below. */}
          {hasCatalog && selectedComponents.length > 0 ? (
            <div className="border-b bg-muted/10 px-3 py-3">
              <div className="flex gap-3 overflow-x-auto pb-1">
                {selectedComponents.map((c) => (
                  <div key={c.id} className="flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border bg-white">
                    <div className="border-b bg-muted/30 px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-foreground">
                      {c.component}
                    </div>
                    <div className="px-2 py-1">
                      {(c.rows ?? []).length === 0 && readOnly && (
                        <p className="px-1 py-2 text-center text-[11px] text-muted-foreground">Satır yok.</p>
                      )}
                      {(c.rows ?? []).map((r) =>
                        readOnly ? (
                          <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.3fr)] items-center gap-1 border-b py-1 last:border-b-0">
                            <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{r.label}</span>
                            <span className="text-xs font-bold text-muted-foreground">:</span>
                            <span className="min-w-0 text-[12px]">{r.value}</span>
                          </div>
                        ) : (
                          <div key={r.id} className="flex items-center gap-1.5 border-b py-1 last:border-b-0">
                            <input
                              value={r.label}
                              onChange={(e) => updateComponentRow(c.id, r.id, 'label', e.target.value)}
                              placeholder="ALAN"
                              className="w-24 shrink-0 bg-transparent text-[11px] font-semibold uppercase tracking-wide outline-none placeholder:text-muted-foreground/50"
                            />
                            <span className="text-xs font-bold text-muted-foreground">:</span>
                            <input
                              value={r.value}
                              onChange={(e) => updateComponentRow(c.id, r.id, 'value', e.target.value)}
                              placeholder="Değer"
                              className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/50"
                            />
                            <button
                              type="button"
                              onClick={() => removeComponentRow(c.id, r.id)}
                              aria-label="Satırı silin"
                              className="shrink-0 rounded p-0.5 text-muted-foreground transition active:scale-90 hover:text-destructive"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ),
                      )}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => addComponentRow(c.id)}
                          className="mt-1 inline-flex items-center gap-1 px-1 py-1 text-[11px] font-semibold text-primary transition active:scale-95 hover:opacity-80"
                        >
                          <Plus className="h-3 w-3" /> Satır Ekleyin
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {!readOnly && (
                <p className="mt-2 px-1 text-[10px] text-muted-foreground">
                  Buradaki düzenlemeler Ürün Bilgileri'ne de kaydedilir.
                </p>
              )}
            </div>
          ) : (
            <>
              {/* İŞİN ADI + user-added rows (no catalog / nothing selected) */}
              <div className="border-b px-4 py-1">
                <Row label="İŞİN ADI" name="isinAdi" value={form.isinAdi} onChange={handleChange} readOnly={systemRowReadOnly} />
                {customRows.map((r) => (
                  <CustomRow
                    key={r.id}
                    id={r.id}
                    label={r.label}
                    value={r.value}
                    onChange={updateCustomRow}
                    onRemove={removeCustomRow}
                    readOnly={readOnly}
                  />
                ))}
              </div>

              {/* + Satır Ekleyin — hidden in read-only mode */}
              {!readOnly && (
                <div className="border-b px-4 py-2.5">
                  <button
                    type="button"
                    onClick={addCustomRow}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-4 w-4" />
                    Satır Ekleyin
                  </button>
                </div>
              )}
            </>
          )}

          {/*
            Auto-filled bottom fields.
            These are system-driven (today / signed-in user / assigned approver).
          */}
          <div className="px-4 py-1">
            {/* İSTEM rows are shown to every role — the matbaa needs to know
                who requested the demo/ozalit and when, not just its own
                delivery stamp. */}
            <Row label={variant.dateLabel}   name={variant.dateField}   value={form[variant.dateField]}   onChange={handleChange} readOnly={systemRowReadOnly} />
            {/* BASIM YERİ — right before HAZIRLAYAN, per the feature ask. */}
            {variant.locationField && (
              <Row
                label={variant.locationLabel}
                name={variant.locationField}
                value={form[variant.locationField] ?? ''}
                onChange={handleChange}
                readOnly={readOnly}
              />
            )}
            <Row label={variant.personLabel} name={variant.personField} value={form[variant.personField]} onChange={handleChange} readOnly />
            {/* Blank until handleAdvance stamps them at the moment of teslimat. */}
            {(user?.role === 'printer' || form.teslimTarihi || form.teslimEdenKisi) && (
              <>
                <Row label="TESLİM TARİHİ"    name="teslimTarihi"   value={form.teslimTarihi   ?? ''} onChange={handleChange} readOnly={systemRowReadOnly} />
                <Row label="TESLİM EDEN KİŞİ" name="teslimEdenKisi" value={form.teslimEdenKisi ?? ''} onChange={handleChange} readOnly />
              </>
            )}
            {form.matbaaYetkilisi && <Row label="MATBAA YETKİLİSİ" name="matbaaYetkilisi" value={form.matbaaYetkilisi} onChange={handleChange} readOnly />}
            {form.onaylayanKisi && <Row label="ONAYLAYAN KİŞİ" name="onaylayanKisi" value={form.onaylayanKisi} onChange={handleChange} readOnly />}
          </div>
        </div>

        {readOnly && (
          <div className="flex divide-x overflow-hidden rounded-lg border bg-white">
            <SigBox role="Tasarımcı" name={(project?.assignees ?? []).map((a) => a.name).join(', ') || project?.assigned_name || ''} />
            {form.matbaaYetkilisi && <SigBox role="Matbaa Yetkilisi" name={form.matbaaYetkilisi} />}
            {form.onaylayanKisi && <SigBox role="Ekip Lideri / Onaylayan" name={form.onaylayanKisi} />}
          </div>
        )}
        </>
        )}

        {/* Ozalit receipt gate — the approve below stays disabled until the
            proof is acknowledged. The confirm is inline (a second click on the
            same spot) rather than a nested dialog. */}
        {isOzalitApproval && (
          ozalitReceived ? (
            ozalitAwaitingLeader ? (
              <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                <Check className="h-4 w-4 shrink-0" />
                <span>
                  Ozalit teslim alındı{project?.ozalit_received_by ? `, ${project.ozalit_received_by}` : ''}.
                  Onay sırası ekip liderinde, o onayladıktan sonra onaylayabilirsiniz.
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
                <Check className="h-4 w-4 shrink-0" />
                <span>
                  Ozalit teslim alındı{project?.ozalit_received_by ? `, ${project.ozalit_received_by}` : ''}. Onaylayabilirsiniz.
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
        {lockedByStart && (user?.role === 'team_leader' || user?.role === 'designer') && (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <FileText className="h-4 w-4 shrink-0" />
            <span>
              Matbaa {variant.kind === 'demo' ? 'demo' : 'ozalit'} üzerinde çalışmaya başladı.
              Değişiklik yapmak için "Değişiklik İste" düğmesini kullanın.
            </span>
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
          {mode === 'view' && (!variant.saveRequiresEditable || !readOnly) && (
            <Button onClick={handleSave}>Kaydedin</Button>
          )}
          {mode === 'advance' && (
            <Button disabled={busy} onClick={handleAdvance}>
              <Send className="h-4 w-4" />
              {busy ? 'Gönderiliyor…' : variant.advanceLabel(user)}
            </Button>
          )}
          {isBaskiOnayApproval && !baskiOnayPrepared && (
            <Button disabled={busy} onClick={handlePrepareBaskiOnay}>
              <Send className="h-4 w-4" />
              {busy ? 'Kaydediliyor…' : 'Hazırlayın ve Onaya Gönderin'}
            </Button>
          )}
          {mode === 'approve' && (!isBaskiOnayApproval || baskiOnayPrepared) && (
            <Button variant="success" disabled={busy || needsOzalitReceive || ozalitAwaitingLeader} onClick={handleApprove}>
              <Check className="h-4 w-4" />
              {busy ? 'İşleniyor…' : 'Onaylayın'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
