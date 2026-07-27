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

