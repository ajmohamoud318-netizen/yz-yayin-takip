/**
 * Unit tests for the İç Sayfalar page-list normaliser. Pure JS — no DB,
 * no route. This is the gate between a designer's comma list ("1,5, 7")
 * and the INSERTs that follow it, and the route trusts its output twice:
 * it reads the LAST segment for the total_pages bound (so the sort has
 * to be real), and it assumes segments can't collide with each other (so
 * the merge has to be real). Both are silent failures if they regress —
 * a bad sort accepts an out-of-range save, a bad merge makes a save
 * reject itself with a confusing overlap error.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_BATCH_SEGMENTS,
  batchCounter,
  formatSegments,
  readBatchSegments,
} from './page-segments.js'

describe('readBatchSegments', () => {
  it('accepts the single-range body shape', () => {
    assert.deepEqual(
      readBatchSegments({ pages: 5, start_page: 1 }),
      [{ startPage: 1, pages: 5 }],
    )
  })

  it('accepts a segments list', () => {
    assert.deepEqual(
      readBatchSegments({
        segments: [
          { start_page: 1, pages: 1 },
          { start_page: 5, pages: 1 },
          { start_page: 7, pages: 1 },
        ],
      }),
      [
        { startPage: 1, pages: 1 },
        { startPage: 5, pages: 1 },
        { startPage: 7, pages: 1 },
      ],
    )
  })

  it('sorts segments so the last one holds the highest page', () => {
    // The route's total_pages check reads only the last segment.
    const out = readBatchSegments({
      segments: [
        { start_page: 9, pages: 2 },
        { start_page: 2, pages: 1 },
        { start_page: 5, pages: 1 },
      ],
    })
    assert.deepEqual(out.map((s) => s.startPage), [2, 5, 9])
    const last = out[out.length - 1]
    assert.equal(last.startPage + last.pages - 1, 10)
  })

  it('merges overlapping and adjacent segments', () => {
    // Without this the save would trip the route's own overlap guard
    // against a row it is about to write in the same transaction.
    assert.deepEqual(
      readBatchSegments({
        segments: [{ start_page: 1, pages: 5 }, { start_page: 3, pages: 1 }],
      }),
      [{ startPage: 1, pages: 5 }],
    )
    assert.deepEqual(
      readBatchSegments({
        segments: [{ start_page: 1, pages: 3 }, { start_page: 4, pages: 3 }],
      }),
      [{ startPage: 1, pages: 6 }],
    )
    assert.deepEqual(
      readBatchSegments({
        segments: [{ start_page: 2, pages: 1 }, { start_page: 2, pages: 1 }],
      }),
      [{ startPage: 2, pages: 1 }],
    )
  })

  it('leaves a one-page gap alone', () => {
    assert.deepEqual(
      readBatchSegments({
        segments: [{ start_page: 1, pages: 3 }, { start_page: 5, pages: 1 }],
      }),
      [{ startPage: 1, pages: 3 }, { startPage: 5, pages: 1 }],
    )
  })

  it('rejects a body carrying neither shape', () => {
    assert.throws(() => readBatchSegments({}), /segments veya pages/)
    assert.throws(() => readBatchSegments({ segments: [] }), /boş olamaz/)
  })

  it('rejects non-positive or non-numeric pages', () => {
    assert.throws(() => readBatchSegments({ pages: 0, start_page: 1 }), /sıfırdan büyük/)
    assert.throws(() => readBatchSegments({ pages: 1, start_page: 0 }), /en az 1/)
    assert.throws(() => readBatchSegments({ pages: 'x', start_page: 1 }), /pages bir sayı/)
    assert.throws(
      () => readBatchSegments({ segments: [{ start_page: 1, pages: 1 }, { start_page: 0, pages: 1 }] }),
      /en az 1/,
    )
  })

  it('refuses more segments than the cap', () => {
    const seg = (i) => ({ start_page: i * 2 + 1, pages: 1 })
    const at = Array.from({ length: MAX_BATCH_SEGMENTS }, (_, i) => seg(i))
    const over = Array.from({ length: MAX_BATCH_SEGMENTS + 1 }, (_, i) => seg(i))
    assert.equal(readBatchSegments({ segments: at }).length, MAX_BATCH_SEGMENTS)
    assert.throws(() => readBatchSegments({ segments: over }), /en fazla/)
  })
})

describe('formatSegments', () => {
  it('renders the list the way the designer typed it', () => {
    assert.equal(
      formatSegments([
        { startPage: 1, pages: 1 },
        { startPage: 5, pages: 1 },
        { startPage: 7, pages: 3 },
      ]),
      '1, 5, 7-9',
    )
  })

  it('renders a single range as before', () => {
    assert.equal(formatSegments([{ startPage: 1, pages: 8 }]), '1-8')
    assert.equal(formatSegments([{ startPage: 4, pages: 1 }]), '4')
  })

  it('is empty for nothing', () => {
    assert.equal(formatSegments([]), '')
    assert.equal(formatSegments(null), '')
  })
})

describe('batchCounter', () => {
  // The route reads and reports these columns, and migration 082's trigger
  // writes the same pair — a sticker batch reported against pages_done would
  // show "0 / 24" while the row itself says 24.
  it('counts İç Sayfalar in pages', () => {
    const c = batchCounter('pages')
    assert.equal(c.total, 'total_pages')
    assert.equal(c.done, 'pages_done')
    assert.equal(c.unit, 'sayfa')
  })

  it('counts Sticker in stickers', () => {
    const c = batchCounter('sticker-count')
    assert.equal(c.total, 'total_stickers')
    assert.equal(c.done, 'stickers_done')
    assert.equal(c.unit, 'sticker')
  })

  it('refuses every kind that is still a checkbox', () => {
    assert.equal(batchCounter('check'), null)
    assert.equal(batchCounter(undefined), null)
  })
})
