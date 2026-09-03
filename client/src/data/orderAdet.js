const KEY = 'yz_order_adet_v1'

/** Called when Esra submits a sipariş talebi — stores the ordered quantity by project. */
export function storeOrderAdet(projectId, items, quantity) {
  if (!projectId) return
  try {
    const all = JSON.parse(localStorage.getItem(KEY)) ?? {}
    all[projectId] = {
      quantity: quantity ?? 0,
      items: Array.isArray(items) ? items : [],
      updatedAt: new Date().toISOString(),
    }
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch { /* ignore quota / parse errors */ }
}

/**
 * Returns { quantity, items, updatedAt } for the most recent order on this project,
 * or null if no order has been placed yet.
 */
export function loadOrderAdet(projectId) {
  if (!projectId) return null
  try {
    const all = JSON.parse(localStorage.getItem(KEY)) ?? {}
    return all[projectId] ?? null
  } catch { return null }
}

/*
 * There is no row-builder here any more. ADET used to be prepended to a Demo /
 * Ozalit sheet's custom rows — where it never actually rendered, because the
 * parça blocks replace customRows the moment a project has a catalog. The
 * quantity now appears once, on the Baskı Onay Formu, as a row inside each
 * parça's own block: see lib/spec-form-adet.js#withAdetRow for the placement
 * and #adetForComponent for reading a per-parça number off what is stored
 * above.
 */
