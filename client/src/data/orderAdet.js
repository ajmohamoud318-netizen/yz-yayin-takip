import { formatNumber } from '@/lib/utils'

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

/**
 * Builds the ADET custom-row(s) to prepend to a Demo / Ozalit form.
 * Returns [] if no order ADET is stored for the project.
 *
 * If the order has per-component items (e.g. Kitap: 500, Kutu: 250) each gets its own row.
 * If it's a single quantity, one "ADET" row is returned.
 */
export function buildAdetRows(projectId) {
  const order = loadOrderAdet(projectId)
  if (!order) return []

  const { quantity, items } = order

  if (Array.isArray(items) && items.length > 1) {
    return items.map((item) => ({
      id: `order-adet-${item.name}-${Date.now()}`,
      label: `ADET (${item.name})`,
      value: formatNumber(item.quantity),
    }))
  }

  return [{
    id: `order-adet-${Date.now()}`,
    label: 'ADET',
    value: formatNumber(quantity),
  }]
}

/**
 * ADET row(s) for a sipariş's own ozalit sheet, read straight off the order.
 *
 * The project pipeline's buildAdetRows above has to guess: it reads
 * localStorage, keyed by project id, holding only the most recent order, and
 * written only on the browser that submitted it. A sipariş doesn't need to
 * guess — the quantity it was raised for is on the row. Same output shape, so
 * both feed the sheet identically.
 *
 * `items` may be a list of names (older payloads) or of { name, quantity };
 * per-parça quantities each get their own row, a single total gets one.
 */
export function buildOrderAdetRows(order) {
  if (!order) return []
  const quantity = order.quantity ?? 0
  const items = Array.isArray(order.items) ? order.items : []
  const detailed = items.filter((i) => i && typeof i === 'object' && i.quantity != null)
  if (detailed.length > 1) {
    return detailed.map((item) => ({
      id: `order-adet-${item.name}-${Date.now()}`,
      label: `ADET (${item.name})`,
      value: formatNumber(item.quantity),
    }))
  }
  if (!quantity) return []
  return [{
    id: `order-adet-${Date.now()}`,
    label: 'ADET',
    value: formatNumber(quantity),
  }]
}
