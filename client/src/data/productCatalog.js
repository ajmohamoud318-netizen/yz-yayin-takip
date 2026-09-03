// Bridge between Ürün Bilgileri (editable product catalog) and the
// Demo / Ozalit forms. Exposes the same shape Ürün Bilgileri writes:
//   { component, date, fields: [{ k, v }] }
//
// Reads order:
//   1) server cache (the `product_info` table, primed on boot) — the source
//      of truth, shared across users and browsers
//   2) localStorage overrides (offline mirror / fallback only)
//   3) JSON seed fetched lazily from /data/product-info.json (offline fallback)
//
// Writes go to the server (via `api.saveProductInfo`) and update both the
// in-memory cache and the localStorage mirror so the UI is instant and still
// works offline. Reads stay synchronous (many call sites are useMemo bodies);
// `hydrateProductInfo()` fills the cache from the server ahead of time and
// pre-loads the JSON seed so synchronous reads can fall back to it.
import api from '@/api'
import { inferParcaKind } from '@/data/parcaTemplates'
import { isAdetLabel } from '@/lib/spec-form-adet'

// Lazy-loaded seed data — starts empty, populated by loadSeed() during
// hydrateProductInfo(). Replaces the old static import of productInfo.js.
let _seed = {}

/** Returns the lazily-loaded seed data (empty object until hydration). */
export function getSeedData() {
  return _seed
}

const LS_KEY = 'yz_product_info_overrides_v1'
const clone = (x) => JSON.parse(JSON.stringify(x ?? []))

// Backfill `kind` on rows that came from localStorage / the offline JSON seed
// (both predate the field). The server backfills on read, but those code paths
// can still hand us an untagged row when the client is offline or before
// hydrate has settled. The rule itself lives in data/parcaTemplates so this,
// components/SpecSheet and the spec form can never disagree about what a
// given parça is.
function _withKind(comps) {
  if (!Array.isArray(comps)) return []
  return comps.map((c) => (c && typeof c === 'object' && c.kind) ? c : { ...c, kind: inferParcaKind(c?.component) })
}

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
    if (r && r.project_id) serverCache.set(r.project_id, _withKind(r.components))
  }
}

/**
 * Fetch the JSON seed from /data/product-info.json into the module-level
 * cache. Called once during hydrateProductInfo() so synchronous reads can
 * fall back to it when the server is unreachable.
 */
async function loadSeed() {
  try {
    const res = await fetch('/data/product-info.json')
    if (res.ok) _seed = await res.json()
  } catch {
    // Offline or missing — seed stays empty, reads fall through to localStorage.
  }
}

/**
 * Load every project's spec from the server into the cache. Also performs a
 * one-time backfill: any localStorage override for a *real* project that the
 * server doesn't have yet is pushed up, so specs authored before this feature
 * existed aren't lost. Safe to call repeatedly (e.g. on every projects
 * refetch); the backfill is a no-op once the server has the row.
 *
 * Also pre-loads the JSON seed (from /data/product-info.json) so synchronous
 * reads can fall back to it for orphan entries when offline.
 *
 * `realProjectIds` scopes the backfill so we never push orphan (p-x…) seed
 * overrides or synthetic ids to the server.
 */
export async function hydrateProductInfo(realProjectIds = []) {
  // Load the seed first (fast local fetch) so it's available for synchronous
  // reads before the server response arrives.
  const seedPromise = loadSeed()
  let rows
  try {
    rows = await api.listProductInfo()
    primeProductInfoCache(rows)
  } catch {
    // Offline / unauthenticated — sync reads fall back to localStorage + seed.
    // Ensure the seed is loaded even if the server fetch failed.
    await seedPromise
    return
  }
  const overrides = readOverrides()
  const realSet = new Set(realProjectIds)
  const backfills = []
  for (const [pid, comps] of Object.entries(overrides)) {
    if (!realSet.has(pid)) continue          // real projects only
    if (serverCache.has(pid)) continue        // server already has it
    if (!Array.isArray(comps) || comps.length === 0) continue
    const backfilled = _withKind(comps)
    serverCache.set(pid, backfilled)
    backfills.push(api.saveProductInfo(pid, backfilled).catch(() => { /* keep the mirror */ }))
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
  // Ensure the seed is loaded by the time hydration completes.
  await seedPromise
}

/** Returns the components array for a given project, or [] if none. */
export function getComponentsForProject(projectId) {
  if (!projectId) return []
  if (serverCache.has(projectId)) return serverCache.get(projectId)
  const overrides = readOverrides()
  const fromOverrides = overrides[projectId]
  if (fromOverrides !== undefined) return _withKind(fromOverrides)
  return _withKind(_seed[projectId])
}

/**
 * Every kayıt (backlist) spec that has no project behind it yet.
 *
 * `_seed` is fetched from /data/product-info.json (generated from REÇETE.xlsx)
 * and keyed by seed id (`p-x1`…).
 * A seed with no matching project exists only in this browser: it can't be
 * saved server-side (`PUT /product-info/p-x1` 404s) and Sales can't order it.
 * Promoting it via `POST /api/projects/import` creates the real project and
 * makes the spec persistent — see AGENTS.md → "Kayıtlı ürünler (legacy)".
 *
 * Pass the ids of every project that exists (including legacy imports and any
 * stage), so already-promoted seeds drop out of the list.
 *
 * @param {string[]} realProjectIds
 * @returns {{ id: string, title: string, comps: any[] }[]}
 */
export function listRecordSeeds(realProjectIds = []) {
  const real = new Set(realProjectIds)
  const overrides = readOverrides()
  const ids = new Set([...Object.keys(_seed), ...Object.keys(overrides)])
  const out = []
  for (const pid of ids) {
    if (real.has(pid)) continue
    const comps = getComponentsForProject(pid)
    if (!Array.isArray(comps) || comps.length === 0) continue
    // Mirrors the orphan-row title logic in pages/UrunBilgileri.jsx: the spec's
    // own "İŞİN ADI" field is the product name; fall back to the component name.
    const first = comps[0]
    const titleField = (first?.fields ?? []).find(
      (f) => String(f?.k ?? '').toLocaleUpperCase('tr-TR') === 'İŞİN ADI',
    )?.v
    out.push({ id: pid, title: titleField || first?.component || pid, comps })
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, 'tr'))
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
    if (!f) continue
    // A row earns its place with a LABEL or a value, not with a value alone.
    // Requiring the value dropped every field a parça declares but nobody has
    // filled in yet — the KUTU template's four rows, the Ana Parça's seeded
    // ADET / EBAT — so a freshly created project opened its demo form with an
    // empty parça block and the leader retyped the field names the seed had
    // just written. saveEditedComponents keeps label-only rows on the way back
    // out, so this is the read side finally agreeing with the write side.
    // Genuinely blank rows (both halves empty) are still skipped.
    if (!String(f.k ?? '').trim() && !String(f.v ?? '').trim()) continue
    // İŞİN ADI is the component's title — the caller renders it as the header,
    // so it must not also appear as a spec row (that duplicated it on the
    // printed sheet and in the on-screen cards).
    if (String(f.k ?? '').toLocaleUpperCase('tr-TR') === 'İŞİN ADI') continue
    rows.push({
      id: `seed-${i++}-${Math.random().toString(36).slice(2, 8)}`,
      label: f.k ?? '',
      value: f.v ?? '',
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
        // ADET is one print run's quantity, not a fact about the product —
        // writing it here would make the next sipariş inherit the previous
        // run's number. The server drops it on capture for the same reason
        // (services/product-info-capture.js#isAdetLabel); this is the edit
        // path saying so too, since a Baskı Onay Formu now carries an ADET row
        // inside every parça block.
        .filter((r) => !isAdetLabel(r.label))
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

