/**
 * Tests for the order-insensitive equality helper used by
 * `project-service.js` and `orders-service.js`.
 *
 * Each `assert.equal(eq, …)` line is exactly the comparison the orchestrator
 * performs: `JSON.stringify(canonicalise(a)) === JSON.stringify(canonicalise(b))`.
 * Asserting on the helper directly (rather than on the diff) keeps the test
 * narrow: a regression here is caught here, a regression in the orchestrator
 * is caught there. The orchestrator-level coverage lives next to
 * `orders-service.test.js` ("still bumps version when a command changes no
 * column at all") and proves the end-to-end fix — this file just makes sure
 * the helper itself does what the diff thinks it does.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { canonicalise } from './deep-equal.js'

/** The orchestrator's exact equality shape. */
function eq(a, b) {
  return JSON.stringify(canonicalise(a)) === JSON.stringify(canonicalise(b))
}

describe('canonicalise — arrays of plain objects', () => {
  it('treats [{id:L1},{id:D1}] and [{id:D1},{id:L1}] as equal', () => {
    const a = [{ id: 'L1' }, { id: 'D1' }]
    const b = [{ id: 'D1' }, { id: 'L1' }]
    assert.equal(eq(a, b), true)
  })

  it('canonicalises nested object keys inside array entries', () => {
    // Same data, two different insertion orders for both the array and the
    // nested `role` key. JSON.stringify is order-sensitive on both, so the
    // raw stringify check would flag these as different.
    const a = [
      { id: 'L1', role: 'team_leader', name: 'Ayşenur' },
      { id: 'D1', role: 'designer', name: 'Abdijibar' },
    ]
    const b = [
      { name: 'Abdijibar', id: 'D1', role: 'designer' },
      { name: 'Ayşenur', id: 'L1', role: 'team_leader' },
    ]
    assert.equal(eq(a, b), true)
  })

  it('still flags a real addition (a new approver) as different', () => {
    // Same as the previous case but `b` has an extra entry — this MUST
    // register as different, otherwise the orchestrator would silently drop
    // a legitimate state change.
    const a = [{ id: 'L1' }]
    const b = [{ id: 'L1' }, { id: 'D1' }]
    assert.equal(eq(a, b), false)
  })

  it('still flags a real removal as different', () => {
    const a = [{ id: 'L1' }, { id: 'D1' }]
    const b = [{ id: 'L1' }]
    assert.equal(eq(a, b), false)
  })

  it('still flags a real change of value as different', () => {
    const a = [{ id: 'L1', role: 'team_leader' }]
    const b = [{ id: 'L1', role: 'designer' }]
    assert.equal(eq(a, b), false)
  })

  it('treats an empty array as equal to itself', () => {
    assert.equal(eq([], []), true)
  })

  it('treats an empty array as NOT equal to a populated one', () => {
    assert.equal(eq([], [{ id: 'L1' }]), false)
  })
})

describe('canonicalise — arrays of primitives', () => {
  it('treats ["D1","D2"] and ["D2","D1"] as equal (no .id key to sort by)', () => {
    // assignee_ids is the live case: an array of designer ids, no nested
    // objects. The idKey fallback (JSON.stringify of the element) handles it.
    assert.equal(eq(['D1', 'D2'], ['D2', 'D1']), true)
  })

  it('still flags a real difference in primitive arrays', () => {
    assert.equal(eq(['D1'], ['D2']), false)
    assert.equal(eq(['D1', 'D2'], ['D1']), false)
  })
})

describe('canonicalise — plain objects', () => {
  it('treats deeply nested objects with reordered keys as equal', () => {
    // baski_onay_form is a JSONB column with no array — just a plain object.
    // The orchestrator diff fires whenever its key insertion order changes;
    // canonicalise fixes that by sorting keys at every level.
    const a = {
      components: ['Kapak', { id: 's-1', label: 'İç Sayfalar' }],
      adet: '500',
      tarih: '2026-09-01',
      basimYeri: 'İstanbul',
      hazirlayan: 'Ayşenur',
      nested: { z: 1, a: 2, m: { q: 'x', p: 'y' } },
    }
    const b = {
      hazirlayan: 'Ayşenur',
      basimYeri: 'İstanbul',
      tarih: '2026-09-01',
      adet: '500',
      nested: { m: { p: 'y', q: 'x' }, a: 2, z: 1 },
      components: [{ label: 'İç Sayfalar', id: 's-1' }, 'Kapak'],
    }
    assert.equal(eq(a, b), true)
  })

  it('still flags a real difference in object values', () => {
    const a = { adet: '500', tarih: '2026-09-01' }
    const b = { adet: '500', tarih: '2026-09-02' }
    assert.equal(eq(a, b), false)
  })
})

describe('canonicalise — primitives', () => {
  it('returns primitives untouched', () => {
    assert.equal(canonicalise(42), 42)
    assert.equal(canonicalise('hello'), 'hello')
    assert.equal(canonicalise(true), true)
    assert.equal(canonicalise(null), null)
  })
})

describe('canonicalise — stable output', () => {
  it('returns the same canonical form for inputs that differ only by key/array order', () => {
    // Stronger contract: the canonicalised shape is deterministic, so
    // `canonicalise(a) === canonicalise(b)` (referential equality is fine
    // since the helper builds a fresh object each call, but the SHAPE has
    // to match) for any two inputs that describe the same data.
    const a = canonicalise([{ id: 'L1', name: 'a' }, { id: 'D1', name: 'b' }])
    const b = canonicalise([{ name: 'b', id: 'D1' }, { name: 'a', id: 'L1' }])
    assert.deepEqual(a, b)
  })
})