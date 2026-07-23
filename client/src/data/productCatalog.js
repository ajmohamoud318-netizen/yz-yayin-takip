// Bridge between Ürün Bilgileri (editable product catalog) and the
// Demo / Ozalit forms. Exposes the same shape Ürün Bilgileri writes:
//   { component, date, fields: [{ k, v }] }
//
// Reads order:
//   1) localStorage overrides (browser-only, set by Ürün Bilgileri "Kaydet")
//   2) bundled PRODUCT_INFO seed (read-only reference)
//
// Falls back gracefully if either layer is missing or storage is unavailable.
import PRODUCT_INFO from '@/data/productInfo'
import { SUBTASK_LIBRARY } from '@/domain/constants/subtasks'

const LS_KEY = 'yz_product_info_overrides_v1'

function readOverrides() {
  if (typeof localStorage === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) ?? {}
  } catch {
    return {}
  }
}

function writeOverrides(next) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next))
  } catch {
    /* ignore quota */
  }
}

/** Returns the components array for a given project, or [] if none. */
export function getComponentsForProject(projectId) {
  if (!projectId) return []
  const overrides = readOverrides()
  return overrides[projectId] ?? PRODUCT_INFO[projectId] ?? []
}

/**
 * Returns the project components as pre-filled form rows, omitting the
 * "İŞİN ADI" row (the caller usually puts that into the form header).
 * Each row: { id, label, value } — id is stable per render via a counter.
 */
export function getComponentRows(component) {
  if (!component) return []
  const rows = []
  let i = 0
  for (const f of component.fields ?? []) {
    if (!f || !f.v) continue
    rows.push({
      id: `seed-${i++}-${Math.random().toString(36).slice(2, 8)}`,
      label: f.k,
      value: f.v,
    })
  }
  return rows
}

/* ============================================================================
 * Template helpers — used by NewProjectDialog to seed subtasks from an
 * existing Ürün Bilgileri product, and to copy the chosen template's
 * components onto the freshly created project so the catalog picks them up.
 *
 * Design notes:
 *  - Orphan templates = seed PRODUCT_INFO entries + override-only entries
 *    that are NOT linked to a real project. These are the "reusable
 *    templates" the team leader can start a new project from.
 *  - Inference is heuristic: we match component names / fields to
 *    SUBTASK_LIBRARY keys. If the heuristic misses, the leader can still
 *    fine-tune the checkboxes manually — auto-fill is a starting point,
 *    not a contract.
 *  - Page / sticker counts are derived from fields like "SAYFA SAYISI":
 *    "80 sayfa + kapak" → 80. The parser picks the first integer that
 *    appears in the field value, which matches every spec sheet in the
 *    current PRODUCT_INFO seed.
 * ========================================================================== */

/**
 * Field lookup helpers. The catalog uses Turkish uppercase keys like
 * "SAYFA SAYISI", "STICKER ADET", "SETTEKİ KİTAP SAYISI" — match them
 * case-insensitively so the inference doesn't break when the leader
 * edits an existing template and re-types a field name.
 */
function findField(components, key) {
  if (!Array.isArray(components)) return null
  const needle = String(key).toLocaleLowerCase('tr-TR')
  for (const c of components) {
    for (const f of c.fields ?? []) {
      if (!f?.k) continue
      if (String(f.k).toLocaleLowerCase('tr-TR') === needle) return f.v ?? ''
    }
  }
  return null
}

/**
 * Heuristic mapping from a component name to subtask keys.
 * Returns the union of subtasks that this component suggests.
 */
function subtasksForComponentName(name) {
  if (!name) return new Set()
  const upper = String(name).toLocaleUpperCase('tr-TR')
  const out = new Set()
  if (upper.includes('KUTU')) out.add('kutu')
  if (upper.includes('STICKER') || upper.includes('ÇIKARTMA') || upper.includes('YAPIŞTIR')) {
    out.add('sticker')
  }
  if (upper.includes('SES') || upper.includes('MÜZİK') || upper.includes('SOUND') || upper.includes('AUDIO')) {
    out.add('ses')
  }
  if (upper.includes('YAZILIM') || upper.includes('UYGULAMA') || /\bAPP\b/.test(upper)) {
    out.add('yazilim')
  }
  if (
    upper.includes('VİDEO') ||
    upper.includes('ANIMASYON') ||
    upper.includes('MEDYA') ||
    upper.includes('MEDIA') ||
    upper.includes('ANİME')
  ) {
    out.add('media')
  }
  return out
}

/**
 * Heuristic: is this the "main" kitap component (vs a kutu / sticker /
 * ses companion)? We treat the component as main when it carries the
 * typical kitap spec fields (İŞİN ADI / SETTEKİ KİTAP SAYISI / SAYFA EBAT /
 * SAYFA SAYISI / KAPAK KAĞIT CİNSİ / CİLT). When no field hint is
 * available, we fall back to "the first component is always main" — every
 * real-world seed in PRODUCT_INFO follows this shape.
 */
function looksLikeMainComponent(comp, idx) {
  if (!comp) return false
  const keys = (comp.fields ?? []).map((f) => String(f.k ?? '').toLocaleUpperCase('tr-TR'))
  const mainHints = ['İŞİN ADI', 'SETTEKİ KİTAP SAYISI', 'SAYFA EBAT', 'SAYFA SAYISI', 'KAPAK KAĞIT', 'CİLT']
  if (keys.some((k) => mainHints.some((h) => k.includes(h)))) return true
  return idx === 0
}

/** Pulls the first integer out of a free-text field value. */
function parseFirstInt(value) {
  if (value == null) return null
  const m = String(value).match(/\d+/)
  if (!m) return null
  const n = parseInt(m[0], 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Map a components array (the shape stored in PRODUCT_INFO / overrides) to:
 *   - subtasks: { [SUBTASK_LIBRARY.key]: boolean }
 *   - pageCount?: number  — only when the template carries a SAYFA SAYISI
 *   - stickerCount?: number — only when the template carries a sticker count
 *
 * Unrecognised keys default to `false`. The leader can flip them on the
 * dialog before submitting — this is a best-effort suggestion, not a
 * commitment.
 */
export function inferSubtasksFromTemplate(components) {
  const out = SUBTASK_LIBRARY.reduce((acc, s) => ({ ...acc, [s.key]: false }), {})
  if (!Array.isArray(components) || components.length === 0) {
    return { subtasks: out }
  }

  let hasMain = false

  components.forEach((c, idx) => {
    const matched = subtasksForComponentName(c?.component)
    for (const k of matched) out[k] = true
    if (looksLikeMainComponent(c, idx)) {
      hasMain = true
      out.kapak = true
    }
  })

  // If every component has a "kutu-ish" / "sticker-ish" name and none
  // looks like the main kitap, still default to kapak=true — there's
  // almost always a cover even when it's not explicitly named.
  if (!hasMain) out.kapak = true

  const result = { subtasks: out }

  const sayfaSayisi = findField(components, 'SAYFA SAYISI')
  if (sayfaSayisi != null) {
    const n = parseFirstInt(sayfaSayisi)
    if (n != null) {
      out.sayfalar = true
      result.pageCount = n
    }
  }

  // Sticker counts live in fields whose KEY mentions sticker/çıkartma.
  // Iterate over every component field so we don't depend on a strict
  // key name — the team leader may have typed "STICKER ADET" or
  // "ÇIKARTMA SAYISI" or anything in between.
  for (const c of components) {
    for (const f of c.fields ?? []) {
      const k = String(f.k ?? '').toLocaleUpperCase('tr-TR')
      if (!k) continue
      if (k.includes('STICKER') || k.includes('ÇIKARTMA')) {
        const n = parseFirstInt(f.v)
        if (n != null) {
          out.sticker = true
          result.stickerCount = n
          break
        }
      }
    }
    if (result.stickerCount != null) break
  }

  return result
}

/**
 * Extract a sensible default title from a template: prefer the first
 * component's "İŞİN ADI" field, fall back to the component name, then
 * the template id.
 */
export function inferTitleFromTemplate(components, fallback = '') {
  if (!Array.isArray(components) || components.length === 0) return fallback
  const first = components[0]
  const titleField = (first?.fields ?? []).find((f) =>
    String(f.k ?? '').toLocaleUpperCase('tr-TR').includes('İŞİN ADI'),
  )
  return (titleField?.v ?? first?.component ?? fallback ?? '').toString().trim()
}

/**
 * Returns the orphan templates available for "start a new project from…".
 * Orphan = a PRODUCT_INFO entry OR an override entry that does NOT match
 * any real project the team has created. Sorted by the most recent
 * `date` field on the first component, falling back to component name.
 *
 * Shape: [{ id, title, components, summary }].
 */
export function listOrphanTemplates(realProjectIds = []) {
  const overrides = readOverrides()
  const realIds = new Set(realProjectIds)
  const seen = new Set()
  const items = []

  // 1) PRODUCT_INFO seeds — these are the canonical templates that ship
  //    with the app. Anything here is fair game until a real project
  //    claims it (which happens via seedProjectFromTemplate on create).
  for (const id of Object.keys(PRODUCT_INFO)) {
    if (realIds.has(id)) continue
    const components = PRODUCT_INFO[id]
    if (!Array.isArray(components) || components.length === 0) continue
    seen.add(id)
    items.push(buildTemplateItem(id, components, 'seed'))
  }

  // 2) Override-only entries — products the team leader already saved
  //    but hasn't (yet) tied to a real project. The Ürün Bilgileri page
  //    also surfaces these as "synthetic products" so they show up
  //    consistently in both places.
  for (const id of Object.keys(overrides)) {
    if (realIds.has(id) || seen.has(id)) continue
    const components = overrides[id]
    if (!Array.isArray(components) || components.length === 0) continue
    seen.add(id)
    items.push(buildTemplateItem(id, components, 'override'))
  }

  // Sort: most recent first (by the first component's date), then alpha.
  items.sort((a, b) => {
    const da = a.date ?? ''
    const db = b.date ?? ''
    if (da !== db) return db.localeCompare(da, 'tr')
    return a.title.localeCompare(b.title, 'tr')
  })

  return items
}

function buildTemplateItem(id, components, origin) {
  const first = components[0]
  const title = inferTitleFromTemplate(components, id)
  const summary = inferSubtasksFromTemplate(components)
  return {
    id,
    title,
    components,
    date: first?.date ?? '',
    origin, // 'seed' | 'override'
    parcaCount: components.length,
    subtasks: summary.subtasks,
  }
}

/**
 * Copy a template's components into localStorage overrides under the
 * newly created project's id, so Ürün Bilgileri immediately shows it
 * under that project. The team leader can then edit / refine the data
 * from the catalog without having to re-enter it.
 *
 * No-op when components is empty.
 */
export function seedProjectFromTemplate(projectId, components) {
  if (!projectId || !Array.isArray(components) || components.length === 0) return
  const overrides = readOverrides()
  // Clone to keep localStorage decoupled from the in-memory template list.
  const cloned = components.map((c) => ({
    ...c,
    fields: (c.fields ?? []).map((f) => ({ ...f })),
  }))
  writeOverrides({ ...overrides, [projectId]: cloned })
}
