/**
 * Pass (baskı) kinds — what kind of trip through the pipeline a project is on.
 * A project can be created for the first time (`first_edition`) or loop back as
 * a `reprint` (reprint with the existing design) or `redesign` (a new pass
 * after a design revize). The string values are the same ones written to
 * `project.pass_kind` and archived into `passes[]` — keep them stable.
 */

export const PASS_KIND = Object.freeze({
  FIRST_EDITION: 'first_edition',
  REPRINT: 'reprint',
  REDESIGN: 'redesign',
})

/** A user-facing label per pass kind. */
export const PASS_KIND_LABEL = Object.freeze({
  [PASS_KIND.FIRST_EDITION]: 'İlk Baskı',
  [PASS_KIND.REPRINT]: 'Yeniden Baskı',
  [PASS_KIND.REDESIGN]: 'Yeniden Tasarım',
})

/** Type guard — returns true if the value is a known pass kind. */
export function isPassKind(value) {
  return Object.values(PASS_KIND).includes(value)
}

/**
 * Default pass kind inferred from a pass number (Pass 1 = first edition).
 * Accepts missing/null/undefined (→ 1) and treats anything below 1 as Pass 1.
 */
export function defaultPassKindFor(passNumber) {
  const n = passNumber == null || passNumber < 1 ? 1 : passNumber
  return n === 1 ? PASS_KIND.FIRST_EDITION : PASS_KIND.REPRINT
}
