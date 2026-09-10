import { badRequest } from './errors.js'

/**
 * Page-list handling for the designer-batch write ("İç Sayfalar" and,
 * since migration 082, "Sticker").
 *
 * `subtask_designer_batches` stores ONE contiguous range per row
 * ([start_page, start_page + pages - 1]); migration 068's overlap guard
 * and the pages_done counter trigger both build on that. A designer who
 * finished scattered pages types a comma list ("1,5, 7") in the input,
 * so the route splits the list into segments and writes a row each —
 * inside a single transaction, so the save stays atomic.
 *
 * Kept in /domain (not inline in routes/subtasks.js) so the unit test
 * can import it without pulling the db pool in behind the route module.
 */

/**
 * Cap on segments in one save. Each segment is its own INSERT and its
 * own row in the designer's log, so an unbounded paste would turn one
 * gesture into hundreds of both. Mirrored by PAGE_LIST_MAX_SEGMENTS in
 * client/src/lib/page-range.js and the schema's `maxItems`; this copy
 * is the authoritative one.
 */
export const MAX_BATCH_SEGMENTS = 64

/**
 * The subtask kinds logged as numbered designer batches, and what each one
 * counts. İç Sayfalar counts pages; Sticker counts stickers (migration 082 —
 * it used to be a bare checkbox). The batch table's `pages` / `start_page`
 * hold either: for a sticker row they are items, not pages. `total` / `done`
 * are the subtask columns the counter trigger closes against, so the route
 * reads and reports the same pair the trigger writes.
 */
const BATCH_COUNTERS = {
  pages: {
    total: 'total_pages', done: 'pages_done',
    unit: 'sayfa', unitTitle: 'Sayfa', sized: 'sayfalık',
  },
  'sticker-count': {
    total: 'total_stickers', done: 'stickers_done',
    unit: 'sticker', unitTitle: 'Sticker', sized: 'adetlik',
  },
}

/** The counter a subtask kind logs batches against, or null if it doesn't. */
export function batchCounter(kind) {
  return BATCH_COUNTERS[kind] ?? null
}

/**
 * Normalise a designer-batch body into a sorted, non-overlapping list of
 * `{ startPage, pages }` segments.
 *
 * Accepts both body shapes:
 *   • `{ pages, start_page }` — one contiguous range (pre-comma callers,
 *     still supported);
 *   • `{ segments: [{ start_page, pages }, …] }` — a comma list.
 *
 * Overlapping and adjacent segments within one save are merged (1-3 + 4
 * → 1-4, 1-5 + 3 → 1-5): the list means "these pages are done", so a
 * page named twice is a typo to absorb, not a conflict to reject.
 * Merging here also keeps the save from tripping the route's own overlap
 * guard against itself.
 *
 * Throws (via badRequest) on a body carrying neither shape, on too many
 * segments, or on non-positive numbers. The column CHECK would refuse
 * the last of those anyway, but with a bare constraint violation instead
 * of a Turkish message.
 */
export function readBatchSegments(body) {
  const raw = []
  if (Array.isArray(body?.segments)) {
    if (body.segments.length === 0) badRequest('segments boş olamaz.')
    if (body.segments.length > MAX_BATCH_SEGMENTS) {
      badRequest(`Tek seferde en fazla ${MAX_BATCH_SEGMENTS} sayfa aralığı eklenebilir.`)
    }
    for (const seg of body.segments) {
      raw.push(readOneSegment(seg?.pages, seg?.start_page))
    }
  } else if (body?.pages !== undefined || body?.start_page !== undefined) {
    raw.push(readOneSegment(body?.pages, body?.start_page))
  } else {
    badRequest('segments veya pages/start_page gerekli.')
  }

  raw.sort((a, b) => a.startPage - b.startPage)
  const merged = []
  for (const seg of raw) {
    const prev = merged[merged.length - 1]
    const end = seg.startPage + seg.pages - 1
    if (prev && seg.startPage <= prev.startPage + prev.pages) {
      const prevEnd = prev.startPage + prev.pages - 1
      prev.pages = Math.max(prevEnd, end) - prev.startPage + 1
      continue
    }
    merged.push({ startPage: seg.startPage, pages: seg.pages })
  }
  return merged
}

function readOneSegment(pagesRaw, startPageRaw) {
  const pages = Number(pagesRaw)
  const startPage = Number(startPageRaw)
  if (!Number.isFinite(pages)) badRequest('pages bir sayı olmalı.')
  if (!Number.isFinite(startPage)) badRequest('start_page bir sayı olmalı.')
  const seg = { pages: Math.floor(pages), startPage: Math.floor(startPage) }
  if (seg.pages <= 0) badRequest('pages sıfırdan büyük olmalı.')
  if (seg.startPage < 1) badRequest('start_page en az 1 olmalı.')
  return seg
}

/**
 * Render segments the way the designer typed them — "1, 5, 7-9" — for
 * the history note and error messages. A single-page segment prints as
 * a bare number so the common case stays short.
 */
export function formatSegments(segments) {
  if (!Array.isArray(segments)) return ''
  return segments
    .map(({ startPage, pages }) => (
      pages === 1 ? `${startPage}` : `${startPage}-${startPage + pages - 1}`
    ))
    .join(', ')
}
