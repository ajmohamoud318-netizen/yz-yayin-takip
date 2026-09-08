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

/**
 * Should a sheet opened for these parçalar OPEN on them, or on the whole round?
 *
 * `scopeComponents` above decides which blocks a scope covers; this decides
 * whether the sheet starts there. The two are separate because narrowing is
 * always available — the banner above the sheet toggles it — and only the
 * default changes.
 *
 * The rule is the size of the decision. One parça means the reader is acting
 * on one block: the leader's per-row Onayla or Reddedin, the designer's send-
 * back, the correction a released parça is waiting for. A document showing
 * three blocks while the footer says "KUTU · Onaylayın" invites signing off
 * against the wrong one, and the reason typed into a reject dialog behind it
 * names a parça the reader was not looking at.
 *
 * Many parçalar means the opposite: "Tüm parçaları onaylayın" and the matbaa's
 * "Hepsini Başlatın" are decisions about the round, and the round is what has
 * to be read before taking them.
 *
 * Empty or absent is not a scope at all — the sheet was opened without one, so
 * there is nothing to narrow to.
 *
 * @param {string[] | null | undefined} parcaScope
 */
export function opensNarrowed(parcaScope) {
  return (parcaScope ?? []).filter(Boolean).length === 1
}

/**
 * What the sheet must SAY while it is showing more than the decision covers.
 *
 * `opensNarrowed` above starts a one-parça decision on its own block, but the
 * banner offers "Tüm parçaları gösterin" and reading the round is a legitimate
 * thing to want before signing — the leader deciding KUTU may need to see what
 * KİTAP says. The moment they take it, the document stops matching the button:
 * three blocks on screen, one parça in the footer, and nothing on the page
 * saying which. Widen it on a phone and the button is several screens below
 * the blocks it does not cover.
 *
 * Nothing about the ACTION changes with the view — `commitParcaSheet` posts the
 * parçalar the row's button was clicked for, and the footer label names them —
 * so this is not a correctness hole. It is worse in a way: it is a UI that
 * looks like it might be one. So the widened sheet states the scope in the
 * banner, and every block on it is marked as either the one being decided or
 * as context, which leaves nothing for the reader to remember.
 *
 * Returns null for anything that is not a decision, which is every other
 * caller of this sheet.
 *
 * @param {null | undefined | { action?: 'approve' | 'reject' | 'review' }} decisionContext
 */
export function decisionScopeCopy(decisionContext) {
  return DECISION_COPY[decisionContext?.action] ?? null
}

const DECISION_COPY = {
  approve: {
    // Reads inside "…ancak yalnızca KUTU <verb>."
    verb: 'onaylanacak',
    inScope: 'Onayınız bekleniyor — bu parça onaylanacak.',
    outScope: 'Bilgi için gösteriliyor — bu parça onaylanmayacak.',
  },
  reject: {
    verb: 'reddedilecek',
    inScope: 'Bu parça matbaaya geri gönderilecek.',
    outScope: 'Bilgi için gösteriliyor — bu parça reddedilmeyecek.',
  },
  review: {
    verb: 'gönderilecek',
    inScope: 'Bu parça gönderilecek.',
    outScope: 'Bilgi için gösteriliyor — bu parça gönderilmeyecek.',
  },
}
