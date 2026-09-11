/**
 * Unit tests for the counter descriptor lookup. Pure JS — no DB, no
 * route. Migration 084 stripped the old segment parser / formatter,
 * so what's left is a tiny table the route and the trigger both
 * read: pinning it here guarantees a sticker save can't quietly
 * report against `pages_done` (or vice versa), which the tests
 * below would have caught before the wire hit production.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { batchCounter } from './page-segments.js'

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
