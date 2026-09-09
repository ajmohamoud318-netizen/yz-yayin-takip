/**
 * Parse a designer page-range input.
 *
 * Accepted shapes:
 *   • "5"      → single page at slot 5
 *   • "1-5"    → contiguous range from 1 to 5 (inclusive)
 *   • "1-1"    → single page at slot 1 (same as "1")
 *
 * Returns `{ start, pages }` on success, `null` on parse failure.
 * Whitespace around the dash is tolerated. Anything else (multi-dash,
 * non-digits, reversed ranges, zero, negatives) returns null.
 *
 * Migration 068 — the route pins each batch to a [start, start + pages - 1]
 * range and refuses any save whose range overlaps an existing one, so
 * the designer can't double-count a page already logged (by themselves
 * or a teammate). This parser is the single client-side gate before
 * the round trip.
 *
 * Kept in /lib (not next to DesignerPagesInput) so a unit test can
 * import it without dragging React/jsdom into a pure-function test.
 *
 * Commas are NOT handled here — one call describes one contiguous
 * range. `parsePageList` below splits a comma list ("1,5,7") and calls
 * this for each part.
 */
export function parsePageRange(text) {
  const t = String(text ?? '').trim()
  if (!t) return null
  const m = t.match(/^(\d+)(?:\s*-\s*(\d+))?$/)
  if (!m) return null
  const start = Number(m[1])
  const end = m[2] === undefined ? start : Number(m[2])
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 1 || end < start) return null
  return { start, pages: end - start + 1 }
}

/**
 * Maximum number of segments one save may carry. A designer logging
 * "1,3,5,…" lands one batch row per segment, so an unbounded paste
 * would turn a single gesture into hundreds of INSERTs and hundreds of
 * log rows. 64 is far past any real session and still cheap. Mirrored
 * by the route (server/src/routes/subtasks.js) — this copy only saves
 * the round trip.
 */
export const PAGE_LIST_MAX_SEGMENTS = 64

/**
 * Parse a comma-separated designer page list.
 *
 * Accepted shapes — any mix of the single-page and range forms
 * `parsePageRange` takes, joined by commas:
 *   • "5"          → [{ start: 5, pages: 1 }]
 *   • "1-5"        → [{ start: 1, pages: 5 }]
 *   • "1,5, 7"     → [{ start: 1 }, { start: 5 }, { start: 7 }] (1 page each)
 *   • "1-3, 8-9"   → [{ start: 1, pages: 3 }, { start: 8, pages: 2 }]
 *
 * Returns a normalised array of `{ start, pages }` segments — sorted by
 * `start`, with overlapping and adjacent segments merged ("1-3,4,3" →
 * a single 1-4). The semantics are a union of pages the designer
 * claims, so a repeated page is a typo we absorb rather than an error
 * we throw back at them. Empty segments are skipped, which makes a
 * trailing comma ("1,5,") harmless mid-typing.
 *
 * Returns `null` on parse failure (any segment `parsePageRange`
 * rejects, nothing parseable at all, or more than
 * PAGE_LIST_MAX_SEGMENTS segments after the merge).
 *
 * Each segment lands as its own row in `subtask_designer_batches` —
 * the table stores one contiguous [start_page, start_page + pages - 1]
 * range per row, and the overlap guard + pages_done trigger both build
 * on that. Splitting here (rather than teaching the table about page
 * lists) keeps migration 068's invariants intact.
 */
export function parsePageList(text) {
  const t = String(text ?? '').trim()
  if (!t) return null
  const segments = []
  for (const part of t.split(',')) {
    if (!part.trim()) continue
    const seg = parsePageRange(part)
    if (!seg) return null
    segments.push(seg)
  }
  if (segments.length === 0) return null

  // Merge on a sorted copy so "5,1-3,2" collapses to 1-3 + 5 instead of
  // producing overlapping rows the server would reject against itself.
  // Adjacent segments merge too (1-3 + 4-6 → 1-6): same pages, one row.
  segments.sort((a, b) => a.start - b.start)
  const merged = []
  for (const seg of segments) {
    const prev = merged[merged.length - 1]
    const end = seg.start + seg.pages - 1
    if (prev && seg.start <= prev.start + prev.pages) {
      const prevEnd = prev.start + prev.pages - 1
      prev.pages = Math.max(prevEnd, end) - prev.start + 1
      continue
    }
    merged.push({ start: seg.start, pages: seg.pages })
  }
  if (merged.length > PAGE_LIST_MAX_SEGMENTS) return null
  return merged
}

/**
 * Render segments back as the compact list a designer typed: "1, 5, 7-9".
 * Used in the input's own validation messages so the error names the
 * pages the way they entered them (post-merge), not a raw start/pages pair.
 */
export function formatPageList(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return ''
  return segments
    .map(({ start, pages }) => {
      const end = start + pages - 1
      return start === end ? `${start}` : `${start}-${end}`
    })
    .join(', ')
}

/** Total pages covered by a normalised (non-overlapping) segment list. */
export function countPageListPages(segments) {
  if (!Array.isArray(segments)) return 0
  return segments.reduce((acc, s) => acc + Number(s?.pages ?? 0), 0)
}
