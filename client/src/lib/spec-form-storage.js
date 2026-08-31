/**
 * Spec-sheet persistence — where a Demo / Ozalit / Baskı Onay sheet is read
 * from and written to, and what a saved sheet is allowed to carry forward.
 *
 * Split out of SpecFormDialog.jsx (slice: client god-components). Two stores
 * back every sheet: localStorage (per browser, the offline fallback) and the
 * `demos` table via /api/demos (per project+kind+attempt, so any browser can
 * reopen it). Everything here is about those two and the stamp rules that
 * decide which of them may win — no React, no UI.
 *
 * `stampSpecSignature` is re-exported from SpecFormDialog.jsx, so existing
 * imports keep working.
 */

import api from '@/api'
import { VARIANTS } from '@/lib/spec-form-variants'

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
  const fields = ['isinAdi', variant.dateField, variant.personField, 'teslimEdenKisi', 'teslimTarihi', 'teslimAlanKisi', 'onaylayanKisi', 'matbaaYetkilisi']
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

export function loadSaved(variant, id)             { return parseSaved(variant, localStorage.getItem(STORAGE_KEY(variant, id))) }
export function loadSnapshot(variant, id, attempt) { return parseSaved(variant, localStorage.getItem(SNAPSHOT_KEY(variant, id, attempt))) }

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
const STAMP_FIELDS = ['onaylayanKisi', 'teslimTarihi', 'teslimEdenKisi', 'teslimAlanKisi', 'matbaaYetkilisi']

export function stripStamps(data) {
  if (!data) return data
  const form = { ...(data.form ?? {}) }
  for (const f of STAMP_FIELDS) delete form[f]
  return { ...data, form }
}

/**
 * Put the round's own stamps back on a form whose SPEC came from the
 * project-level blob.
 *
 * `stripStamps` exists so a previous attempt's signatures can't bleed onto a
 * fresh sheet — but the plain viewer of an ALREADY-SENT round reads its spec
 * from that same stripped blob, and so lost the very stamps it is supposed to
 * show. The matbaa opening the demo he had just delivered got an empty TESLİM
 * TARİHİ / TESLİM EDEN KİŞİ pair; everyone else got no teslim rows at all,
 * because those rows only render once one of them has a value. The stamps
 * were never missing — `current`, this attempt's own snapshot, had them the
 * whole time, and it was being consulted only when the blob was absent
 * entirely.
 *
 * So: spec from wherever it came from, stamps from the round. Blank stamps
 * are skipped for the reason `withoutBlankStamps` gives — "not yet" is not
 * "by nobody".
 */
export function withRoundStamps(data, roundSnapshot) {
  const stamps = roundSnapshot?.form
  if (!data || !stamps) return data
  const form = { ...(data.form ?? {}) }
  for (const f of STAMP_FIELDS) if (stamps[f]) form[f] = stamps[f]
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
export function withoutBlankStamps(form) {
  const out = { ...(form ?? {}) }
  for (const f of STAMP_FIELDS) if (!out[f]) delete out[f]
  return out
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
export async function fetchServerSnapshot(variant, projectId, attempt, orderId = null) {
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
export async function fetchServerSnapshotById(variant, demoId) {
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
export function moveById(rows, id, dir) {
  const list = rows ?? []
  const from = list.findIndex((r) => r.id === id)
  const to = from + dir
  if (from < 0 || to < 0 || to >= list.length) return list
  const next = [...list]
  const [row] = next.splice(from, 1)
  next.splice(to, 0, row)
  return next
}

export function saveForm(variant, id, data, customRows, selectedComponents) {
  localStorage.setItem(STORAGE_KEY(variant, id), JSON.stringify({
    ...data,
    _customRows: customRows,
    _selectedComponents: selectedComponents ?? null,
  }))
}
export function saveSnapshot(variant, id, attempt, data, customRows, selectedComponents) {
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
    (await fetchServerSnapshot(variant, project.id, [attempt, attempt + 1], orderId)) ??
    loadSnapshot(variant, scopeId, attempt) ??
    stripStamps(loadSaved(variant, scopeId)) ??
    stripStamps(await fetchServerSnapshot(variant, project.id, null, orderId)) ??
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

export function emptyForm(variant, project, user) {
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
export function missingRequiredFields(variant, form) {
  return [
    [variant.adetField, variant.adetLabel],
    [variant.locationField, variant.locationLabel],
  ]
    .filter(([field]) => field && !String(form?.[field] ?? '').trim())
    .map(([, label]) => label)
}
