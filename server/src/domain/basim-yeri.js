/**
 * BASIM YERİ on a spec sheet — where ONE parça is printed.
 *
 * The server twin of the client's lib/spec-form-basim.js, and it exists for the
 * same two reasons `domain/adet.js` does:
 *
 *  - `services/product-info-capture.js` drops it when copying an approved sheet
 *    into `product_info`. Where a run was printed is not a property of the
 *    product; baking it into the catalog would make the next sipariş inherit
 *    the previous one's press.
 *  - `entities/Order.js` requires it before a siparis_baski_onay form may be
 *    prepared or approved — the matbaa physically prints from it.
 *
 * It used to be a single künye field on both sides, on the reasoning that the
 * press is a fact about the sheet. It is not: parçalar of one product go to
 * different publishers often enough that one box could only ever describe some
 * of them. A book printed in İstanbul with its box made in Ankara is one sheet
 * with two answers.
 *
 * Prefix on 'BASIM YER', not equality: the trailing İ folds differently in
 * en-US and tr-TR, and sheets written before the move carry the label in both
 * shapes. Nothing else on a spec sheet starts that way.
 */

const up = (s) => String(s ?? '').toLocaleUpperCase('tr-TR').trim()

export const isBasimYeriLabel = (label) => up(label).startsWith('BASIM YER')

/**
 * Does every block on the sheet name a press?
 *
 * `blocks` are the sheet's parça blocks in the shape the client saves them:
 * `[{ component, rows: [{ label, value }] }]`. A sheet with no blocks at all
 * names one nowhere, so it cannot answer yes — the caller decides what to do
 * about that (see Order._assertBaskiOnayFormComplete, which falls back to the
 * legacy top-level `basimYeri` field for sheets saved before the move).
 */
export function everyBlockHasBasimYeri(blocks) {
  const list = Array.isArray(blocks) ? blocks.filter(Boolean) : []
  if (list.length === 0) return false
  return list.every((b) =>
    (Array.isArray(b.rows) ? b.rows : []).some(
      (r) => isBasimYeriLabel(r?.label) && String(r?.value ?? '').trim(),
    ),
  )
}
