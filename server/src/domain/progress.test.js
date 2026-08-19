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
})
