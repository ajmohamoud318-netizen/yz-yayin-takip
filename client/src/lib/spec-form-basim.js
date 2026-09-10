/**
 * BASIM YERİ on a spec sheet — where ONE parça is printed.
 *
 * It used to be a single künye field, on the reasoning that it is a fact about
 * the sheet. It is not: parçalar of the same product go to different publishers
 * often enough that one box at the top of the form could only ever describe
 * some of them. A book printed in İstanbul with its box made in Ankara has two
 * answers, and the sheet the matbaa reads has to carry both.
 *
 * So it behaves like ADET (lib/spec-form-adet.js), with one difference that
 * matters:
 *
 *  - It lives in the PARÇA's spec block, under ADET, because that is where the
 *    matbaa reads it.
 *  - It never reaches the catalog. `product_info` describes the product across
 *    every run, and where a run was printed is not a property of the product —
 *    the next order would inherit the previous run's press. Stripped on capture
 *    (server) and on catalog edit (client), exactly as ADET is.
 *  - UNLIKE ADET, the künye field stays — as a default rather than as the
 *    value. Most sheets do print everywhere in one place, and making a leader
 *    type the same city into four blocks would be a worse form, not a more
 *    honest one. What the künye holds is "where this sheet goes unless a parça
 *    says otherwise"; `applyBasimYeriToBlocks` is that "unless".
 *
 * Pure helpers, no React, so the placement and the fill-down rules can be
 * tested without mounting a sheet.
 */

import { isAdetLabel } from '@/lib/spec-form-adet'

export const BASIM_YERI_LABEL = 'BASIM YERİ'

const norm = (s) => String(s ?? '').toLocaleUpperCase('tr-TR').trim()

/**
 * Prefix on 'BASIM YER', not equality on the whole label.
 *
 * The trailing İ is the reason: 'BASIM YERİ'.toUpperCase() folds differently in
 * en-US and tr-TR, and sheets written before this move carry the label in both
 * shapes (see useSpecSheet's OLD_FIELD_LABELS lift). Matching the stem catches
 * every one of them, and nothing else on a spec sheet starts that way.
 */
export const isBasimYeriLabel = (label) => norm(label).startsWith('BASIM YER')

/** Every BASIM YERİ row removed — what a catalog write must never carry. */
export function withoutBasimYeriRows(rows) {
  return (rows ?? []).filter((r) => !isBasimYeriLabel(r?.label))
}

let seq = 0
const basimRowId = () => `basim-${Date.now()}-${seq++}`

/**
 * The parça's rows with a BASIM YERİ row on them, directly after ADET.
 *
 * Same rule as `withAdetRow`: a row already there keeps its place and its
 * value, because the leader may have pointed this parça at a different press
 * and a reopened sheet must show what was approved. An existing but EMPTY one
 * is filled, so a block saved before the press was decided picks up the künye's
 * answer later.
 *
 * A parça with no ADET row takes the row at the end of its block rather than
 * the top — ADET is the anchor here, and where it is absent the press is the
 * last thing on the block rather than the first.
 */
export function withBasimYeriRow(rows, value = '') {
  const list = rows ?? []
  const at = list.findIndex((r) => isBasimYeriLabel(r?.label))
  if (at !== -1) {
    if (!value || String(list[at].value ?? '').trim()) return list
    return list.map((r, i) => (i === at ? { ...r, value } : r))
  }
  const after = list.findIndex((r) => isAdetLabel(r?.label))
  const next = [...list]
  const row = { id: basimRowId(), label: BASIM_YERI_LABEL, value: value ?? '' }
  if (after === -1) next.push(row)
  else next.splice(after + 1, 0, row)
  return next
}

/**
 * Push the künye's BASIM YERİ down into the blocks that are still following it.
 *
 * "Still following" is the whole idea, and it is why this takes the PREVIOUS
 * künye value as well as the next one. A block is following when it is blank or
 * when it still says exactly what the künye said a moment ago; a block someone
 * has pointed at another press says something else, and keeps saying it.
 *
 * So: type "İstanbul" and every block reads İstanbul. Change KUTU to "Ankara"
 * and it stays Ankara. Correct the künye to "İzmir" and the book follows while
 * the box does not — which is the behaviour a shared default has to have to be
 * worth keeping.
 *
 * @param {Array<{ rows?: Array<{label?: string, value?: string}> }>} blocks
 * @param {string} prev — what the künye held before this edit
 * @param {string} next — what it holds now
 */
export function applyBasimYeriToBlocks(blocks, prev, next) {
  const was = String(prev ?? '').trim()
  return (blocks ?? []).map((block) => {
    const rows = block?.rows ?? []
    const at = rows.findIndex((r) => isBasimYeriLabel(r?.label))
    if (at === -1) return { ...block, rows: withBasimYeriRow(rows, next) }
    const current = String(rows[at].value ?? '').trim()
    // Blank, or still tracking the old default. An overridden block is left be.
    if (current !== '' && current !== was) return block
    return { ...block, rows: rows.map((r, i) => (i === at ? { ...r, value: next } : r)) }
  })
}

/** The same fill-down for the custom-row body a project with no catalog uses. */
export function applyBasimYeriToRows(rows, prev, next) {
  return applyBasimYeriToBlocks([{ rows }], prev, next)[0].rows
}

/**
 * The Baskı Onay Formu's BASIM YERİ gate, as the one label to name in "… boş
 * bırakılamaz."
 *
 * Mirrors `missingAdetLabel`: null when every block has a press, the bare label
 * when they are all blank (or there is only one block), and the offenders named
 * when only some are — so a leader looking at four blocks on a phone knows
 * which one to scroll to.
 */
export function missingBasimYeriLabel(blocks) {
  const list = (blocks ?? []).filter(Boolean)
  if (list.length === 0) return null
  const blank = list.filter(
    (b) => !(b.rows ?? []).some((r) => isBasimYeriLabel(r?.label) && String(r?.value ?? '').trim()),
  )
  if (blank.length === 0) return null
  if (blank.length === list.length || list.length === 1) return BASIM_YERI_LABEL
  return `${BASIM_YERI_LABEL} (${blank.map((b) => b.component).filter(Boolean).join(', ')})`
}
