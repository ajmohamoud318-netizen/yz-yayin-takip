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

import { parsePageRange } from '@/lib/page-range'

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
    // Comma-separated ranges — explicitly out of scope; designer
    // should log two batches.
    expect(parsePageRange('1,3,5')).toBeNull()
    // Letters
    expect(parsePageRange('abc')).toBeNull()
    expect(parsePageRange('1a-5')).toBeNull()
  })

  it('extracts start even with a high end', () => {
    expect(parsePageRange('100-200')).toEqual({ start: 100, pages: 101 })
  })
})
