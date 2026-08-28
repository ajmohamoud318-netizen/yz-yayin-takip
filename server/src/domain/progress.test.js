/**
 * Server-side mirror tests. Kept deliberately identical in shape to the
 * client-side domain tests (`client/src/domain/services/progress.test.js`)
 * so the two domains are guaranteed to agree.
 *
 * Run with: node --test server/src/domain/*.test.js
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { subtaskProgress } from './progress.js'

describe('subtaskProgress', () => {
  it('returns 0 for empty / missing input', () => {
    assert.equal(subtaskProgress([]), 0)
    assert.equal(subtaskProgress(), 0)
  })

  it('returns 0 when nothing is done', () => {
    assert.equal(subtaskProgress([{ is_done: false }, { is_done: false }]), 0)
  })

  it('returns 100 when all are done', () => {
    assert.equal(subtaskProgress([{ is_done: true }, { is_done: true }]), 100)
  })

  it('rounds partial progress', () => {
    assert.equal(
      subtaskProgress([{ is_done: true }, { is_done: false }, { is_done: false }]),
      33,
    )
    assert.equal(
      subtaskProgress([{ is_done: true }, { is_done: true }, { is_done: false }]),
      67,
    )
  })

  it('excludes "Yazılım" from progress entirely — selecting it never blocks 100%', () => {
    const subs = [
      { title: 'Kapak', is_done: true },
      { title: 'Kutu', is_done: true },
      { title: 'Yazılım', is_done: false },
    ]
    assert.equal(subtaskProgress(subs), 100)
  })

  it('weights pages subtasks by pages_done / total_pages', () => {
    // 2 subtasks: a pages subtask 24/48 done (50%) and a check subtask
    // not done (0%). Score: 0.5 + 0 = 0.5 / 2 = 25%.
    const subs = [
      { kind: 'pages', pages_done: 24, total_pages: 48, is_done: false },
      { kind: 'check', is_done: false },
    ]
    assert.equal(subtaskProgress(subs), 25)
  })

  it('weights sticker-count subtasks by stickers_done / total_stickers', () => {
    // 3 sticker subtasks with varying completion ratios.
    // Score: 0.5 + 1.0 + 0.0 = 1.5 / 3 = 50%.
    const subs = [
      { kind: 'sticker-count', stickers_done: 1, total_stickers: 2, is_done: false },
      { kind: 'sticker-count', stickers_done: 3, total_stickers: 3, is_done: true },
      { kind: 'sticker-count', stickers_done: 0, total_stickers: 4, is_done: false },
    ]
    assert.equal(subtaskProgress(subs), 50)
  })

  it('moves the project bar as designers check pages off incrementally', () => {
    // The progress bar that used to jump from 0% to N% in one step the
    // moment the last page shipped. With the per-subtask ratio model,
    // 24/48 pages done contributes 0.5 to the score, so the bar moves
    // as designers work through the chip grid.
    const subs = [
      { kind: 'check', is_done: true },     // 1.0
      { kind: 'check', is_done: false },    // 0.0
      { kind: 'pages', pages_done: 24, total_pages: 48, is_done: false },  // 0.5
      { kind: 'pages', pages_done: 8, total_pages: 32, is_done: false },   // 0.25
    ]
    // (1 + 0 + 0.5 + 0.25) / 4 = 1.75 / 4 = 0.4375 → 44%
    assert.equal(subtaskProgress(subs), 44)
  })

  it('clamps pages_done above total_pages to 1', () => {
    // Defensive: a subtask with pages_done > total_pages (the route
    // shouldn't allow this, but the function should never NaN out).
    const subs = [
      { kind: 'pages', pages_done: 50, total_pages: 48, is_done: true },
      { kind: 'check', is_done: false },
    ]
    assert.equal(subtaskProgress(subs), 50)
  })

  it('falls back to is_done when total_pages is 0', () => {
    // Misconfigured page subtask — no denominator. Falls back to the
    // boolean instead of NaN.
    const subs = [
      { kind: 'pages', pages_done: 0, total_pages: 0, is_done: true },
      { kind: 'check', is_done: false },
    ]
    assert.equal(subtaskProgress(subs), 50)
  })
})
