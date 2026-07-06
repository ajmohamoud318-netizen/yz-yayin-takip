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

const LS_KEY = 'yz_product_info_overrides_v1'

function readOverrides() {
  if (typeof localStorage === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) ?? {}
  } catch {
    return {}
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
