/**
 * Small module holding the pages / sticker-count counter descriptors
 * used by the designer-batch route and the trigger-driven counter
 * recompute (`recompute_subtask_pages_counter` — see migration 067,
 * extended for Sticker in migration 082).
 *
 * Migration 084 collapsed the old slot-range model into a plain
 * "+N pages I did today" contribution against a single shared
 * counter, so the parser / formatter that used to live here
 * (`readBatchSegments`, `formatSegments`, `MAX_BATCH_SEGMENTS`) is
 * gone with it. What's left is the tiny lookup table that maps a
 * subtask `kind` to the column pair the trigger writes and the
 * Turkish words the route uses for messages — the same shape both
 * the route and the trigger read, so a Sticker batch can't
 * accidentally close against `pages_done` or the other way round.
 *
 * Kept in /domain (not inline in routes/subtasks.js) so the unit
 * test can pin the mapping without pulling the db pool in behind
 * the route module.
 */

/**
 * The subtask kinds logged as designer batches, and what each one
 * counts. İç Sayfalar counts pages; Sticker counts stickers (migration
 * 082 — it used to be a bare checkbox). The batch table's `pages`
 * column holds either: for a sticker row the number is items, not
 * pages. `total` / `done` are the subtask columns the counter trigger
 * closes against, so the route reads and reports the same pair the
 * trigger writes.
 */
const BATCH_COUNTERS = {
  pages: {
    total: 'total_pages', done: 'pages_done',
    unit: 'sayfa', unitTitle: 'Sayfa',
  },
  'sticker-count': {
    total: 'total_stickers', done: 'stickers_done',
    unit: 'sticker', unitTitle: 'Sticker',
  },
}

/** The counter a subtask kind logs batches against, or null if it doesn't. */
export function batchCounter(kind) {
  return BATCH_COUNTERS[kind] ?? null
}
