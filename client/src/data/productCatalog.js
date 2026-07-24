// Bridge between Ürün Bilgileri (editable product catalog) and the
// Demo / Ozalit forms. Exposes the same shape Ürün Bilgileri writes:
//   { component, date, fields: [{ k, v }] }
//
// Reads order:
//   1) server cache (the `product_info` table, primed on boot) — the source
//      of truth, shared across users and browsers
//   2) localStorage overrides (offline mirror / fallback only)
//   3) bundled PRODUCT_INFO seed (read-only reference / orphan templates)
//
// Writes go to the server (via `api.saveProductInfo`) and update both the
// in-memory cache and the localStorage mirror so the UI is instant and still
// works offline. Reads stay synchronous (many call sites are useMemo bodies);
// `hydrateProductInfo()` fills the cache from the server ahead of time.
import api from '@/api'
import PRODUCT_INFO from '@/data/productInfo'
import { SUBTASK_LIBRARY } from '@/domain/constants/subtasks'

const LS_KEY = 'yz_product_info_overrides_v1'
const clone = (x) => JSON.parse(JSON.stringify(x ?? []))

// projectId -> components[]. Primed from the server by hydrateProductInfo().
const serverCache = new Map()

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

/** Fold a server list response ([{ project_id, components }]) into the cache. */
export function primeProductInfoCache(rows) {
  if (!Array.isArray(rows)) return
  for (const r of rows) {
    if (r && r.project_id) serverCache.set(r.project_id, Array.isArray(r.components) ? r.components : [])
  }
}

/**
 * Load every project's spec from the server into the cache. Also performs a
 * one-time backfill: any localStorage override for a *real* project that the
 * server doesn't have yet is pushed up, so specs authored before this feature
 * existed aren't lost. Safe to call repeatedly (e.g. on every projects
 * refetch); the backfill is a no-op once the server has the row.
 *
 * `realProjectIds` scopes the backfill so we never push orphan (p-x…) seed
 * overrides or synthetic ids to the server.
 */
export async function hydrateProductInfo(realProjectIds = []) {
  let rows
  try {
    rows = await api.listProductInfo()
    primeProductInfoCache(rows)
  } catch {
    // Offline / unauthenticated — sync reads fall back to localStorage + seed.
    return
  }
  const overrides = readOverrides()
  const realSet = new Set(realProjectIds)
  const backfills = []
  for (const [pid, comps] of Object.entries(overrides)) {
    if (!realSet.has(pid)) continue          // real projects only
    if (serverCache.has(pid)) continue        // server already has it
    if (!Array.isArray(comps) || comps.length === 0) continue
    serverCache.set(pid, comps)
    backfills.push(api.saveProductInfo(pid, comps).catch(() => { /* keep the mirror */ }))
  }
  // Once the server is the confirmed source of truth (and any legacy specs
  // have been backfilled), rewrite the localStorage mirror to exactly what the
  // server holds. This drops stale/orphan overrides — including ones for
  // deleted projects and the p-x… seed masks — so a cold-start read can never
  // momentarily surface a wrong spec before hydrate finishes. The mirror stays
  // valid as an offline cache; it's just no longer a source of legacy junk.
  await Promise.allSettled(backfills)
  const mirror = {}
  for (const [pid, comps] of serverCache) mirror[pid] = comps
  writeOverrides(mirror)
}

/** Returns the components array for a given project, or [] if none. */
export function getComponentsForProject(projectId) {
  if (!projectId) return []
  if (serverCache.has(projectId)) return serverCache.get(projectId)
  const overrides = readOverrides()
  return overrides[projectId] ?? PRODUCT_INFO[projectId] ?? []
}

/**
 * Persist a project's components: server (source of truth) + in-memory cache +
 * localStorage mirror. Returns the cloned components. Never throws — if the
 * network is down the local mirror still updates and hydrate will backfill
 * later.
 */
export async function saveComponentsForProject(projectId, components) {
  if (!projectId) return []
  const cloned = clone(components)
  serverCache.set(projectId, cloned)
  writeOverrides({ ...readOverrides(), [projectId]: cloned })
  try {
    await api.saveProductInfo(projectId, cloned)
  } catch {
    /* offline — mirror + cache remain; hydrate backfills on reconnect */
  }
  return cloned
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
    // İŞİN ADI is the component's title — the caller renders it as the header,
    // so it must not also appear as a spec row (that duplicated it on the
    // printed sheet and in the on-screen cards).
    if (String(f.k ?? '').toLocaleUpperCase('tr-TR') === 'İŞİN ADI') continue
    rows.push({
      id: `seed-${i++}-${Math.random().toString(36).slice(2, 8)}`,
      label: f.k,
      value: f.v,
    })
  }
  return rows
}

/**
 * Merge edited components (from the Demo/Ozalit form's side-by-side cards)
 * back into the project's full spec and persist it, so an edit made while
 * requesting a demo also updates Ürün Bilgileri (and records who changed it).
 *
 * `edited` is a subset in the form's shape: [{ component, rows: [{label,value}] }].
 * We match by component name, rebuild that component's `fields` (İŞİN ADI first,
 * then the edited rows), and leave every other component untouched. Components
 * the user never selected are preserved as-is.
 */
export async function saveEditedComponents(projectId, edited) {
  if (!projectId || !Array.isArray(edited) || edited.length === 0) return getComponentsForProject(projectId)
  const full = clone(getComponentsForProject(projectId))
  const byName = new Map(full.map((c, idx) => [c.component, idx]))
  for (const e of edited) {
    const name = e.component
    if (!name) continue
    const fields = [
      { k: 'İŞİN ADI', v: name },
      ...(e.rows ?? [])
        .filter((r) => (r.label ?? '').trim() || (r.value ?? '').trim())
        .map((r) => ({ k: r.label ?? '', v: r.value ?? '' })),
    ]
    if (byName.has(name)) {
      full[byName.get(name)] = { ...full[byName.get(name)], component: name, fields }
    } else {
      full.push({ component: name, date: '', fields })
    }
  }
  return saveComponentsForProject(projectId, full)
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

/**
 * Every product a new project can be cloned from: the specs of existing
 * projects (so you can copy a project that already has the same parçalar) PLUS
 * the orphan catalog seeds. Unlike listOrphanTemplates this deliberately
 * includes real projects — the whole point is "make a new project just like
 * this existing one". The chosen template's components are deep-copied onto the
 * new project on create (seedProjectFromTemplate), so the source is never
 * touched.
 *
 * `projects` is the project list ({ id, title }). Titles come from the project
 * itself so the picker shows the project name, not the parça name.
 *
 * Shape: [{ id, title, components, parcaCount, origin }] where origin is
 * 'project' | 'seed' | 'override'.
 */
export function listCloneableProducts(projects = []) {
  const items = []
  const seen = new Set()

  // 1) Existing projects that carry a spec.
  for (const p of projects) {
    if (!p?.id) continue
    const components = getComponentsForProject(p.id)
    if (!Array.isArray(components) || components.length === 0) continue
    seen.add(p.id)
    items.push({ ...buildTemplateItem(p.id, components, 'project'), title: p.title || buildTemplateItem(p.id, components, 'project').title })
  }

  // 2) Orphan catalog seeds not tied to a real project.
  for (const t of listOrphanTemplates(projects.map((p) => p.id))) {
    if (seen.has(t.id)) continue
    seen.add(t.id)
    items.push(t)
  }

  items.sort((a, b) => a.title.localeCompare(b.title, 'tr'))
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
export async function seedProjectFromTemplate(projectId, components) {
  if (!projectId || !Array.isArray(components) || components.length === 0) return
  // Persist to the server (+ cache + local mirror) so the freshly created
  // project carries this spec for every user and browser — not just the one
  // the team leader happened to create it on.
  await saveComponentsForProject(projectId, components)
}
