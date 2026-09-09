/**
 * Smoke tests for the page-range parser (migration 068). Pure function,
 * no DOM — the sibling component tests need jsdom but this one doesn't.
 *
 * The parser is the single gate between a designer's keystrokes and
 * the route's body validation; if it accepts garbage, the server
 * surfaces an unfriendly 400. If it rejects valid input, the designer
 * can't ship pages. Both directions are easy to break with a typo, so
 * pin the behaviour by importing the real implementation rather than
 * duplicating it (see __avatar_src.test.js for the same pattern).
 */

import { describe, expect, it } from 'vitest'

import {
  countPageListPages,
  formatPageList,
  parsePageList,
  parsePageRange,
} from '@/lib/page-range'

describe('parsePageRange', () => {
  it('accepts a single page', () => {
    expect(parsePageRange('5')).toEqual({ start: 5, pages: 1 })
  })

  it('accepts a contiguous range', () => {
    expect(parsePageRange('1-5')).toEqual({ start: 1, pages: 5 })
  })

  it('treats "1-1" as a single page', () => {
    expect(parsePageRange('1-1')).toEqual({ start: 1, pages: 1 })
  })

  it('tolerates whitespace around the dash and at the edges', () => {
    expect(parsePageRange('1 - 5')).toEqual({ start: 1, pages: 5 })
    expect(parsePageRange('  3  ')).toEqual({ start: 3, pages: 1 })
  })

  it('returns null on empty input', () => {
    expect(parsePageRange('')).toBeNull()
    expect(parsePageRange('   ')).toBeNull()
    expect(parsePageRange(null)).toBeNull()
    expect(parsePageRange(undefined)).toBeNull()
  })

  it('returns null on reversed ranges', () => {
    expect(parsePageRange('5-3')).toBeNull()
    expect(parsePageRange('10-1')).toBeNull()
  })

  it('returns null on zero or negative numbers', () => {
    expect(parsePageRange('0')).toBeNull()
    expect(parsePageRange('0-5')).toBeNull()
    expect(parsePageRange('-3')).toBeNull()
  })

  it('returns null on multi-dash or other shapes', () => {
    // "1-3-5" — ambiguous, refuse
    expect(parsePageRange('1-3-5')).toBeNull()
    // Comma lists are parsePageList's job, not this one's — a single
    // call still describes a single contiguous range.
    expect(parsePageRange('1,3,5')).toBeNull()
    // Letters
    expect(parsePageRange('abc')).toBeNull()
    expect(parsePageRange('1a-5')).toBeNull()
  })

  it('extracts start even with a high end', () => {
    expect(parsePageRange('100-200')).toEqual({ start: 100, pages: 101 })
  })
})

describe('parsePageList', () => {
  it('wraps a single page or range in a one-segment list', () => {
    expect(parsePageList('5')).toEqual([{ start: 5, pages: 1 }])
    expect(parsePageList('1-5')).toEqual([{ start: 1, pages: 5 }])
  })

  it('splits a comma list into one segment per page', () => {
    expect(parsePageList('1,5,7')).toEqual([
      { start: 1, pages: 1 },
      { start: 5, pages: 1 },
      { start: 7, pages: 1 },
    ])
  })

  it('tolerates the spacing a designer actually types', () => {
    expect(parsePageList('1,5, 7')).toEqual([
      { start: 1, pages: 1 },
      { start: 5, pages: 1 },
      { start: 7, pages: 1 },
    ])
    // Trailing comma — mid-typing, not an error.
    expect(parsePageList('1, 5,')).toEqual([
      { start: 1, pages: 1 },
      { start: 5, pages: 1 },
    ])
  })

  it('mixes ranges and single pages', () => {
    expect(parsePageList('1-3, 8, 11-12')).toEqual([
      { start: 1, pages: 3 },
      { start: 8, pages: 1 },
      { start: 11, pages: 2 },
    ])
  })

  it('sorts out-of-order input', () => {
    expect(parsePageList('9,2,5')).toEqual([
      { start: 2, pages: 1 },
      { start: 5, pages: 1 },
      { start: 9, pages: 1 },
    ])
  })

  it('merges overlapping and adjacent segments into one range', () => {
    // A page named twice is a typo we absorb — the list means "these
    // pages are done", so the union is the honest reading.
    expect(parsePageList('1-5, 3')).toEqual([{ start: 1, pages: 5 }])
    expect(parsePageList('1-3, 4-6')).toEqual([{ start: 1, pages: 6 }])
    expect(parsePageList('2,2,2')).toEqual([{ start: 2, pages: 1 }])
  })

  it('leaves a one-page gap unmerged', () => {
    expect(parsePageList('1-3, 5')).toEqual([
      { start: 1, pages: 3 },
      { start: 5, pages: 1 },
    ])
  })

  it('returns null when any segment is malformed', () => {
    expect(parsePageList('1,abc,5')).toBeNull()
    expect(parsePageList('1,5-3')).toBeNull()
    expect(parsePageList('1,0,5')).toBeNull()
    expect(parsePageList('1,2-3-4')).toBeNull()
  })

  it('returns null on empty input', () => {
    expect(parsePageList('')).toBeNull()
    expect(parsePageList('  ')).toBeNull()
    expect(parsePageList(',')).toBeNull()
    expect(parsePageList(null)).toBeNull()
  })

  it('refuses a paste with more segments than the route accepts', () => {
    // 64 non-adjacent pages is the cap; 65 is one too many. Odd numbers
    // keep them from merging into a single run.
    const at = Array.from({ length: 64 }, (_, i) => i * 2 + 1).join(',')
    const over = Array.from({ length: 65 }, (_, i) => i * 2 + 1).join(',')
    expect(parsePageList(at)).toHaveLength(64)
    expect(parsePageList(over)).toBeNull()
  })
})

describe('formatPageList', () => {
  it('renders segments the way they were typed', () => {
    expect(formatPageList(parsePageList('1,5,7'))).toBe('1, 5, 7')
    expect(formatPageList(parsePageList('1-3, 8'))).toBe('1-3, 8')
    expect(formatPageList(parsePageList('4'))).toBe('4')
  })

  it('returns an empty string for nothing to show', () => {
    expect(formatPageList(null)).toBe('')
    expect(formatPageList([])).toBe('')
  })
})

describe('countPageListPages', () => {
  it('sums the pages a list covers', () => {
    expect(countPageListPages(parsePageList('1,5,7'))).toBe(3)
    expect(countPageListPages(parsePageList('1-5'))).toBe(5)
    // Merged duplicates are counted once, which is what pages_done will
    // read after the batches land.
    expect(countPageListPages(parsePageList('1-5, 3'))).toBe(5)
  })

  it('is 0 for nothing', () => {
    expect(countPageListPages(null)).toBe(0)
    expect(countPageListPages([])).toBe(0)
  })
})
