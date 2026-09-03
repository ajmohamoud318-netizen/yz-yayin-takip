/**
 * ADET on a spec sheet — the quantity of ONE print run.
 *
 * It is not a fact about the product, which is why it is singled out in two
 * unrelated places on this side:
 *
 *  - `services/product-info-capture.js` drops it when copying an approved
 *    sheet into `product_info`. Baking a run's quantity into the catalog would
 *    make the next sipariş inherit the previous one's number.
 *  - `entities/Order.js` requires it before a siparis_baski_onay form may be
 *    prepared or approved — the matbaa physically prints from it.
 *
 * Both need the same answer to "is this row the ADET row", so the predicate
 * lives here. Mirrored on the client by lib/spec-form-adet.js, which also owns
 * where the row sits on the sheet (under the parça's SAYFA SAYISI) and where
 * its value comes from.
 *
 * Prefix, not equality: an order that itemises its parçalar produced rows like
 * "ADET (Kutu)" before the quantity moved into the parça blocks, and those are
 * the same kind of row.
 */

const up = (s) => String(s ?? '').toLocaleUpperCase('tr-TR').trim()

export const isAdetLabel = (label) => up(label).startsWith('ADET')

/**
 * Does every block on the sheet declare a quantity?
 *
 * `blocks` are the sheet's parça blocks in the shape the client saves them:
 * `[{ component, rows: [{ label, value }] }]`. A sheet with no blocks at all
 * carries its quantity nowhere, so it cannot answer yes — the caller decides
 * what to do about that (see Order._assertBaskiOnayFormComplete, which falls
 * back to the legacy top-level `adet` field for sheets saved before the move).
 */
export function everyBlockHasAdet(blocks) {
  const list = Array.isArray(blocks) ? blocks.filter(Boolean) : []
  if (list.length === 0) return false
  return list.every((b) =>
    (Array.isArray(b.rows) ? b.rows : []).some(
      (r) => isAdetLabel(r?.label) && String(r?.value ?? '').trim(),
    ),
  )
}
