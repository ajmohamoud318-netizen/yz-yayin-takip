/**
 * What KIND a parça is, and the rows it arrives with.
 *
 * A KUTU or KILAVUZ sheet always declares the same handful of things — and
 * until now both landed on a new project carrying nothing but their İŞİN ADI,
 * so whoever opened one retyped those field names by hand on every single job.
 * Each list below is the one the catalog already agrees on: 26 of the 38 boxes
 * in Ürün Bilgileri carry the KUTU rows in exactly this order, and the fullest
 * of the guides carries the KILAVUZ ones.
 *
 * Only the LABELS are seeded. A template says what a part has to declare,
 * never what THIS one is, so every value comes to screen empty and waits for
 * the leader. Nothing here is fixed either — once seeded these are ordinary
 * rows, added to, deleted and reordered like any other (FormSheet's
 * SheetSpecRow on the demo/ozalit form, EditableSpecSheet in Ürün Bilgileri).
 */

const up = (s) => String(s ?? '').toLocaleUpperCase('tr-TR').trim()

export const PARCA_KINDS = ['main', 'kutu', 'kilavuz', 'other']

/**
 * A parça's kind from its NAME alone — the fallback for a row that reaches a
 * reader without its `kind` field (an offline cache, a legacy import, a
 * snapshot saved before the field existed). Mirror of
 * server/src/services/product-info-capture.js#inferComponentKind, and the one
 * copy the client keeps: data/productCatalog and components/SpecSheet both
 * defer to it so a part can never be classified two different ways on two
 * different screens.
 */
export function inferParcaKind(name) {
  const upper = up(name)
  if (!upper) return 'main'
  if (upper.includes('KILAVUZ')) return 'kilavuz'
  if (upper.includes('KUTU')) return 'kutu'
  return 'main'
}

/** A component's kind: its own tag when it carries one, its name otherwise. */
export function parcaKind(comp) {
  if (comp && PARCA_KINDS.includes(comp.kind)) return comp.kind
  return inferParcaKind(comp?.component)
}

/** The row whose value the İç Sayfalar subtask owns — see mainTemplateFields. */
export const SAYFA_SAYISI_LABEL = 'SAYFA SAYISI'

/**
 * The lead parça — the product itself. Everything a book declares, and the
 * only template whose SAYFA SAYISI is the count project düzenleme owns (the
 * "Toplam iç sayfa" input); lib/spec-form-resolve substitutes the live total
 * into this row and no sibling's.
 *
 * ADET is deliberately absent. It is the quantity of ONE print run, not a fact
 * about the product — the Baskı Onay Formu gives it a dedicated field and
 * server/src/services/product-info-capture.js strips it back out of the
 * catalog on every capture, so seeding it here only produced a row that
 * silently vanished the first time a sheet was saved.
 */
export const MAIN_TEMPLATE_LABELS = [
  SAYFA_SAYISI_LABEL,
  'SETTEKİ KİTAP SAYISI',
  'SAYFA EBAT',
  'İÇ KAĞIT CİNSİ',
  'KAPAK KAĞIT CİNSİ',
  'CİLT',
  'LAMİNASYON',
]

export const KUTU_TEMPLATE_LABELS = [
  'KUTU AÇIK EBAT',
  'ÜST KAĞIT CİNSİ',
  'ALT KAĞIT',
  'LAMİNASYON',
]

/**
 * The guide is a small booklet in its own right, so it declares the same
 * things a book does — down to a SAYFA SAYISI that is ITS page count and not
 * the product's. That row is why lib/spec-form-resolve only substitutes the
 * live İç Sayfalar total on the `main` parça: a 2-page kılavuz inside a
 * 32-page set must not come to screen reading 32, locked.
 */
export const KILAVUZ_TEMPLATE_LABELS = [
  'SETTEKİ KİTAP SAYISI',
  'SAYFA EBAT',
  'SAYFA SAYISI',
  'İÇ KAĞIT CİNSİ',
  'CİLT',
]

/** The template a parça of this kind arrives with. `other` has none. */
export function templateLabelsForKind(kind) {
  if (kind === 'kutu') return KUTU_TEMPLATE_LABELS
  if (kind === 'kilavuz') return KILAVUZ_TEMPLATE_LABELS
  if (kind === 'main') return MAIN_TEMPLATE_LABELS
  return []
}

/**
 * The template rows this parça is currently missing, in template order.
 *
 * The send gate (lib/spec-form-completeness.js) makes deleting a row the way
 * out of a template line this job doesn't need — so getting one back has to
 * cost a tap, not the retyping of "SETTEKİ KİTAP SAYISI" into a textarea on a
 * phone. Compares by label, so a row the author renamed counts as gone and is
 * offered again; that is the right answer either way, since what they renamed
 * it to is now a different field.
 */
export function missingTemplateLabels(kind, rows) {
  const present = new Set((rows ?? []).map((r) => up(r?.label)).filter(Boolean))
  return templateLabelsForKind(kind).filter((label) => !present.has(up(label)))
}

/**
 * A project's sibling parça, named the way the catalog names one: the job,
 * then the part in caps — "5-8 YAŞ ZEKA VE DİKKAT GELİŞTİRME SETİ KUTU". The
 * name is also the parça's İŞİN ADI, since each parça prints as its own sheet
 * and that sheet has to say which job the part belongs to.
 */
export const kutuComponentName    = (title) => `${String(title ?? '').trim()} KUTU`
export const kilavuzComponentName = (title) => `${String(title ?? '').trim()} KILAVUZ`

const templateFields = (name, labels) => [
  { k: 'İŞİN ADI', v: name },
  ...labels.map((k) => ({ k, v: '' })),
]

/**
 * The lead parça's template. Its name is the job itself — no suffix; the
 * siblings are the ones that have to say which part they are.
 *
 * `pageCountValue` is the one row this cannot fill in blind. A project with
 * the İç Sayfalar subtask seeds the established 'auto' placeholder, which the
 * spec form resolves to the live total on the way to screen; a project without
 * one has no live source, so the row is the leader's like any other and starts
 * empty.
 */
export function mainTemplateFields(title, { pageCountValue = '' } = {}) {
  const name = String(title ?? '').trim()
  return [
    { k: 'İŞİN ADI', v: name },
    ...MAIN_TEMPLATE_LABELS.map((k) => ({ k, v: k === SAYFA_SAYISI_LABEL ? pageCountValue : '' })),
  ]
}

/** The KUTU template as product_info `fields` — İŞİN ADI first, then blanks. */
export function kutuTemplateFields(title) {
  return templateFields(kutuComponentName(title), KUTU_TEMPLATE_LABELS)
}

/** The KILAVUZ template as product_info `fields` — İŞİN ADI first, then blanks. */
export function kilavuzTemplateFields(title) {
  return templateFields(kilavuzComponentName(title), KILAVUZ_TEMPLATE_LABELS)
}
