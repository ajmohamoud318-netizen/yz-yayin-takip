/**
 * Which parçalar a spec sheet carries, and in what order.
 *
 * Pure decision logic, kept out of useSpecSheet so it can be tested without
 * mounting the hook — the same split as lib/spec-form-resolve.js. Two rules
 * live here, and both are about what ticking a checkbox must NOT destroy:
 *
 *  - The rows already on the sheet outrank the catalog's. On most projects
 *    the Baskı Reçeteleri shell is empty (the picker reads "0 satır"); the
 *    rows that matter arrived with the saved snapshot, were typed into this
 *    form, or were resolved from the project (SAYFA SAYISI). Re-adding a
 *    parça straight from the catalog dropped all three — and the next save
 *    wrote the emptied parça back into Ürün Bilgileri, since
 *    saveEditedComponents rebuilds a component's `fields` from exactly these
 *    rows.
 *  - Catalog order is the sheet's order. Each parça prints on its own page,
 *    so appending in tick order meant one sheet came out of the printer with
 *    its pages in a different order depending on which box was clicked
 *    first, and an untick/re-tick silently moved a parça to the back.
 */

/**
 * The parça to put on the sheet, with the rows the sheet already knew about
 * (`remembered`, keyed by component id) winning over the catalog's own.
 * Falls back to the catalog's rows put through `resolveRows` — the same
 * substitution the load effect applies, so a re-ticked parça shows the live
 * SAYFA SAYISI rather than the 'auto' placeholder the recipe shell carries.
 *
 * @param {{ id: string, rows?: any[] }} comp
 * @param {{ remembered?: Map<string, any[]>, resolveRows?: (rows: any[]) => any[] }} opts
 */
export function hydrateComponent(comp, { remembered, resolveRows } = {}) {
  const kept = remembered?.get?.(comp?.id)
  return { ...comp, rows: kept ?? (resolveRows ? resolveRows(comp?.rows ?? []) : comp?.rows ?? []) }
}

/**
 * Sort a selection into catalog order, stably. A parça the catalog doesn't
 * list (carried in from an older snapshot, or a reçete since renamed) keeps
 * its relative order at the end instead of being dropped — the sheet on
 * screen is the document, and nothing may fall off it because the catalog
 * moved on.
 *
 * @param {{ id: string }[]} selection
 * @param {{ id: string }[]} catalog
 */
export function inCatalogOrder(selection, catalog) {
  const rank = new Map((catalog ?? []).map((c, i) => [c.id, i]))
  const last = Number.MAX_SAFE_INTEGER
  return [...(selection ?? [])].sort((a, b) => (rank.get(a?.id) ?? last) - (rank.get(b?.id) ?? last))
}
