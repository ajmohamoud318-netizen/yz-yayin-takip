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
