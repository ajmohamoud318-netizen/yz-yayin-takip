/**
 * ADET on a spec sheet — the quantity of ONE print run.
 *
 * ADET is not a fact about the product, which is why it behaves unlike every
 * other row on the sheet:
 *
 *  - It lives in the PARÇA's spec block, directly under SAYFA SAYISI, because
 *    that is where the matbaa reads it. It used to be a single field at the
 *    top of the künye, which could say only one number — and a sipariş for
 *    5.000 books in 2.500 boxes has two.
 *  - It never reaches the catalog. product_info describes the product across
 *    every run, so the server strips ADET on capture
 *    (services/product-info-capture.js#isAdetLabel) and
 *    productCatalog.saveEditedComponents strips it on the way in. Baking it in
 *    would make the next order inherit the previous run's quantity.
 *  - It appears only on the Baskı Onay Formu — the gate where the number is
 *    finally known. On the sipariş pipeline it arrives filled from the order
 *    the sales team raised; on the project pipeline the leader types it there,
 *    in the same pass as BASIM YERİ.
 *
 * Pure helpers, no React, so the placement and the matching rules can be
 * tested without mounting a sheet.
 */

import { formatNumber } from '@/lib/utils'

export const ADET_LABEL = 'ADET'

const norm = (s) => String(s ?? '').toLocaleUpperCase('tr-TR').trim()

/**
 * Mirror of services/product-info-capture.js#isAdetLabel. Prefix, not equality:
 * an order that itemises its parçalar produced rows like "ADET (Kutu)" on
 * older sheets, and those are the same kind of row.
 */
export const isAdetLabel = (label) => norm(label).startsWith('ADET')

const isSayfaSayisiLabel = (label) => norm(label) === 'SAYFA SAYISI'

/** Every ADET row removed — what a catalog write must never carry. */
export function withoutAdetRows(rows) {
  return (rows ?? []).filter((r) => !isAdetLabel(r?.label))
}

/**
 * The quantity for ONE parça, read off an order-shaped `{ quantity, items }`.
 *
 * `items[].name` is the parça's own name — OrderRequestDialog builds the list
 * straight from `getComponentsForProject(...).map(c => c.component)` — so a
 * book-plus-box order hands each block its own number. An order that carries a
 * single total (no itemisation, or a parça the order never named) gives every
 * block that total, which is what a one-parça product wants anyway.
 */
export function adetForComponent(componentName, order) {
  if (!order) return ''
  const items = Array.isArray(order.items) ? order.items : []
  const match = items.find(
    (i) => i && typeof i === 'object' && i.quantity != null && norm(i.name) === norm(componentName),
  )
  if (match) return formatNumber(match.quantity)
  const total = order.quantity
  return total == null || total === '' ? '' : formatNumber(total)
}

let seq = 0
const adetRowId = () => `adet-${Date.now()}-${seq++}`

/**
 * The parça's rows with an ADET row on them, directly after SAYFA SAYISI.
 *
 * A row that is already there keeps its place and its value — the leader may
 * have corrected the order's number, and a reopened sheet must show what was
 * approved, not what the order said. An existing but EMPTY one is filled, so a
 * sheet saved before the quantity was known picks it up later.
 *
 * A parça with no SAYFA SAYISI row (a box declares no page count) takes the
 * row at the top: there is nothing for it to sit under, and the quantity is
 * the first thing the matbaa looks for.
 */
export function withAdetRow(rows, value = '') {
  const list = rows ?? []
  const at = list.findIndex((r) => isAdetLabel(r?.label))
  if (at !== -1) {
    if (!value || String(list[at].value ?? '').trim()) return list
    return list.map((r, i) => (i === at ? { ...r, value } : r))
  }
  const after = list.findIndex((r) => isSayfaSayisiLabel(r?.label))
  const next = [...list]
  next.splice(after === -1 ? 0 : after + 1, 0, { id: adetRowId(), label: ADET_LABEL, value: value ?? '' })
  return next
}

/**
 * The Baskı Onay Formu's ADET gate, as the one label to name in "… boş
 * bırakılamaz."
 *
 * `blocks` are whatever carries the sheet's spec — the selected parçalar, or
 * the single custom-row body when a project has no catalog. Returns null when
 * every block has its quantity; names the offenders when only some are blank,
 * so a leader looking at four parça blocks on a phone knows which one to
 * scroll to.
 */
export function missingAdetLabel(blocks) {
  const list = (blocks ?? []).filter(Boolean)
  if (list.length === 0) return null
  const blank = list.filter(
    (b) => !(b.rows ?? []).some((r) => isAdetLabel(r?.label) && String(r?.value ?? '').trim()),
  )
  if (blank.length === 0) return null
  if (blank.length === list.length || list.length === 1) return ADET_LABEL
  return `${ADET_LABEL} (${blank.map((b) => b.component).filter(Boolean).join(', ')})`
}
