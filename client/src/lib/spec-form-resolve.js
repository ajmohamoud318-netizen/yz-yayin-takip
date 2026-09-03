import { formatNumber } from '@/lib/utils'

/**
 * Resolve the SAYFA SAYISI row to the project's current İç Sayfalar subtask
 * total. Pure decision logic, kept out of useSpecSheet so it can be tested
 * without mounting the hook (whose import chain reaches lottie-web and dies
 * under jsdom).
 *
 * The page count is owned by project düzenleme (the "Toplam iç sayfa" input
 * under the İç Sayfalar checkbox) — the spec form is read-only for this row
 * by design, so we always honour the live count whenever the project has a
 * pages subtask with a positive total. NewProjectDialog seeds 'auto' onto the
 * recipe shell at creation time as a placeholder, and that placeholder is
 * what gets round-tripped into product_info / the snapshot — we don't try
 * to read either of those for the actual number.
 *
 * A project without İç Sayfalar (or with a subtask whose total_pages isn't
 * yet positive) has no live source — in that case the row is user-owned and
 * passed through as-is, so a manual value survives and stays editable in the
 * spec form.
 *
 * `kind` is the PARÇA this row belongs to, and only the `main` one is the
 * product whose interior İç Sayfalar counts. A sibling's SAYFA SAYISI is its
 * own: the KILAVUZ template ships that row because a guide is a small booklet
 * with its own two or four pages, and substituting the set's 32 into it — then
 * locking the row, see SpecSheetBody.hasLivePageCount — left the leader
 * looking at a guide that claimed to be as long as the book and no way to say
 * otherwise. Defaults to 'main' so the project-level sheet (no parça blocks,
 * customRows only) keeps behaving exactly as before.
 *
 * @param {Array<{label?: string, value?: any}>} rows
 * @param {{ subtasks?: Array<{ kind?: string, total_pages?: number|string }> } | null | undefined} project
 * @param {'main'|'kutu'|'kilavuz'|'other'} [kind]
 * @returns {Array<{label?: string, value?: any}>}
 */
export function resolveSayfaSayisiRows(rows, project, kind = 'main') {
  if (kind !== 'main') return rows ?? []
  const pagesSubtask = (project?.subtasks ?? []).find((s) => s.kind === 'pages')
  const pagesTotal = pagesSubtask && Number(pagesSubtask.total_pages) > 0
    ? Number(pagesSubtask.total_pages)
    : null
  return (rows ?? []).map((r) => {
    if (!r) return r
    if (String(r.label ?? '').trim().toUpperCase() !== 'SAYFA SAYISI') return r
    // Live count wins whenever one exists. The row is locked in the spec form
    // (see SpecSheetBody.hasLivePageCount), so this never overrides anything
    // a user typed there — it overrides only the 'auto' / empty placeholder
    // the project shell was seeded with, plus any stale value that an earlier
    // round's save round-tripped into product_info.
    if (pagesTotal != null) {
      return { ...r, value: formatNumber(pagesTotal) }
    }
    // No live count — user-owned row, pass through.
    return r
  })
}

/**
 * Whether the project has a live page count that should drive the SAYFA SAYISI
 * row. True iff there is a pages subtask with a positive total_pages.
 *
 * Callers must still check the parça: this answers a question about the
 * PROJECT, and only the `main` parça's SAYFA SAYISI is the count it describes
 * (see resolveSayfaSayisiRows above).
 */
export function projectHasLivePageCount(project) {
  return (project?.subtasks ?? []).some(
    (s) => s.kind === 'pages' && Number(s.total_pages) > 0,
  )
}
