/**
 * Narrowing a sheet to the parçalar its reader was actually handed.
 *
 * A round's sheet carries every parça in it — one block per parça, one page
 * each on paper (see lib/spec-form-selection.js). That is right for the person
 * composing it, and wrong for the matbaa: their queue is per-parça (migration
 * 074), so "KUTU · İşlemi Başlatın" opened a three-parça sheet and left them to
 * work out which of the three the button was about. The footer named the parça;
 * the document did not.
 *
 * So the caller that opened the sheet FOR a parça says which — and the sheet
 * shows that parça alone. Bulk ("Hepsini Başlatın") passes every row it is
 * about to stamp, so the scope is exactly what the button covers in both cases.
 *
 * Pure, and deliberately display-only: the dialog narrows what it RENDERS and
 * PRINTS, never `selectedComponents` itself. That state is what every save
 * writes back — to the round's snapshot and to Ürün Bilgileri — and a sheet
 * that showed one parça while saving one parça would drop the other two from
 * the round the moment anybody pressed Kaydet.
 */

/**
 * Parçalar are name-keyed strings everywhere (parca_state.parca, the snapshot's
 * `_selectedComponents`), so matching is by name. Trimmed and case-folded in
 * Turkish — 'i'/'İ' and 'ı'/'I' pair the other way round than in en-US, and a
 * KILAVUZ that came back from the queue as "Kılavuz" must still find its block.
 */
const key = (name) => String(name ?? '').trim().toLocaleUpperCase('tr')

/**
 * The blocks `parcaScope` asks for, in the sheet's own order.
 *
 * No scope (null, empty, all-blank) means the whole sheet — that is every
 * caller that isn't opening the form for a particular parça.
 *
 * A scope that matches nothing also means the whole sheet, deliberately: the
 * queue row and the sheet can legitimately disagree (a parça renamed in Ürün
 * Bilgileri since the round went out, a routing row from a previous round), and
 * an empty document tells the matbaa nothing at all. Showing everything is the
 * behaviour they had before, which is the right thing to fall back to.
 *
 * @param {{ id?: string, component?: string }[]} selectedComponents
 * @param {string[] | null | undefined} parcaScope
 */
export function scopeComponents(selectedComponents, parcaScope) {
  const all = (selectedComponents ?? []).filter(Boolean)
  const wanted = new Set((parcaScope ?? []).map(key).filter(Boolean))
  if (wanted.size === 0) return all
  const kept = all.filter((c) => wanted.has(key(c?.component)))
  return kept.length > 0 ? kept : all
}

/**
 * The parçalar a narrowed sheet is hiding, by name — what the notice above it
 * lists, so nothing on the sheet disappears without saying so.
 *
 * @param {{ id?: string, component?: string }[]} selectedComponents
 * @param {{ id?: string, component?: string }[]} shown
 */
export function hiddenParcaNames(selectedComponents, shown) {
  const on = new Set((shown ?? []).map((c) => key(c?.component)))
  return (selectedComponents ?? [])
    .filter(Boolean)
    .filter((c) => !on.has(key(c?.component)))
    .map((c) => c?.component)
    .filter(Boolean)
}
