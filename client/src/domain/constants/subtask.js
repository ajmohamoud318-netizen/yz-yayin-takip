/**
 * Subtask kinds — discriminates the shape of a subtask entry.
 *
 *   - 'normal' : a simple boolean checklist item (Kapak, Kutu, Ses, …)
 *   - 'pages'  : a page-count subtask (Sayfa Sayısı) tracked with pages_done
 *                vs total_pages; only "done" once pages_done >= total_pages.
 *   - 'revize' : a virtual subtask that surfaces a `needs_revize` flag during
 *                a revision cycle. Synthesised on top of the underlying
 *                normal subtask — they are not real work items.
 */

export const SUBTASK_KIND = Object.freeze({
  NORMAL: 'normal',
  PAGES: 'pages',
  REVIZE: 'revize',
})

/** A user-facing label per subtask kind (used in logs and history notes). */
export const SUBTASK_KIND_LABEL = Object.freeze({
  [SUBTASK_KIND.NORMAL]: 'Normal',
  [SUBTASK_KIND.PAGES]: 'Sayfa Sayısı',
  [SUBTASK_KIND.REVIZE]: 'Revize',
})

export function isSubtaskKind(value) {
  return Object.values(SUBTASK_KIND).includes(value)
}
