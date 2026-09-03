/**
 * Is a Demo / Ozalit sheet fit to be requested?
 *
 * Parçalar now arrive templated (data/parcaTemplates.js): a new project's
 * blocks come to screen with their field NAMES down the left and every value
 * empty, waiting for the leader. That is the point of the templates — but it
 * also means the sheet is now perfectly sendable while saying nothing at all,
 * and a matbaa receiving three pages of "Değer" placeholders has been sent a
 * form, not a spec.
 *
 * So a block has to carry something before it goes out: at least
 * MIN_SPEC_ROWS rows with both a name and a value, and no half-filled ones
 * left over. A leftover row is either a fact nobody supplied or a template
 * line this job doesn't need, and only the author can say which — so the
 * sheet asks them to fill it or delete it rather than guessing.
 *
 * İŞİN ADI is not counted: it is the block's own title, filled automatically
 * from the parça's name, and never one of these rows.
 *
 * Pure — no React, no variant knowledge. The dialog decides WHICH sheets are
 * held to this (see `requiresFilledSpec`) and when.
 */

export const MIN_SPEC_ROWS = 2

const text = (v) => String(v ?? '').trim()

/** A row that actually says something: a field name AND a value for it. */
export const isCompleteRow = (row) => !!text(row?.label) && !!text(row?.value)

/**
 * One block's standing. `complete` counts rows that say something; `partial`
 * counts every other row present — a labelled row nobody filled in, a value
 * with no field name, a blank line left by "Satır Ekleyin".
 */
export function blockReadiness(block) {
  const rows = block?.rows ?? []
  const complete = rows.filter(isCompleteRow).length
  return { complete, partial: rows.length - complete, ready: complete >= MIN_SPEC_ROWS && rows.length === complete }
}

/**
 * The blocks that aren't ready, each as "<PARÇA>: <what to do>".
 *
 * Empty when the sheet is fine, so callers can treat it exactly like
 * missingRequiredFields — a non-empty list disables the send and explains
 * itself above the footer.
 */
export function incompleteSpecBlocks(blocks) {
  const out = []
  for (const block of (blocks ?? []).filter(Boolean)) {
    const { complete, partial, ready } = blockReadiness(block)
    if (ready) continue
    const reason =
      partial > 0 && complete < MIN_SPEC_ROWS
        ? `en az ${MIN_SPEC_ROWS} satır doldurun, kalan boş satırları silin`
        : partial > 0
          ? 'boş satırları doldurun veya silin'
          : `en az ${MIN_SPEC_ROWS} satır doldurun`
    const name = text(block.component)
    out.push(name ? `${name}: ${reason}` : reason)
  }
  return out
}
