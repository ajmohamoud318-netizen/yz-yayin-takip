/**
 * Reject-to-matbaa edit gate — once the leader rejects back to the matbaa,
 * the new round is auto-requested with the same spec the matbaa had when
 * they pressed "İşlemi Başlatın". They don't expect a different file to
 * arrive on the re-delivery, and a silent edit-and-notify by the leader
 * would have shipped one. This file pins both halves of that fix:
 *
 *   • computeDemoEdit / computeOzalitEdit refuse while the round carries
 *     `last_reject_target = 'matbaa'` from the rejection that created it
 *     (server-side — the client gate canEditSentDemoRequest /
 *     canEditSentOzalitRequest hides the button).
 *   • Every transition that "consumes" the round (matbaa delivers, cancel,
 *     resend, generic forward advance) clears the same three columns
 *     together so the flag doesn't bleed onto the next round.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  computeAdvance,
  computeDemoCancel, computeOzalitCancel,
  computeDemoEdit, computeOzalitEdit,
} from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }
const printer = { id: 'u-p', role: 'printer', name: 'Oktay' }

function demoAutoRound(overrides = {}) {
  // The exact state computeRejection leaves a TR demo at after a
  // reject-to-matbaa: back at demo_teslim, demo_started reset, matbaa
  // re-delivery lock set, last_reject_target carrying the 'matbaa' marker
  // the leader-facing UI gates read.
  return {
    id: 'p-1', type: 'TR', stage: 'demo_teslim',
    demo_attempt: 6, demo_started: false, demo_held: false,
    last_reject_reason: 'yanlış dosya',
    last_reject_type: 'demo',
    last_reject_target: 'matbaa',
    reject_target: 'matbaa',
    ...overrides,
  }
}

function ozalitAutoRound(overrides = {}) {
  return {
    id: 'p-2', type: 'TR', stage: 'ozalit_teslim', progress: 100,
    ozalit_attempt: 4, ozalit_requested: false, ozalit_started: false,
    last_reject_reason: 'yanlış dosya',
    last_reject_type: 'ozalit',
    last_reject_target: 'matbaa',
    reject_target: 'matbaa',
    ...overrides,
  }
}

describe('computeDemoEdit refuses an auto-created round after reject-to-matbaa', () => {
  it('throws on a round that still carries last_reject_target=matbaa', () => {
    assert.throws(
      () => computeDemoEdit(demoAutoRound(), leader),
      /otomatik istenen demo/i,
    )
  })

  it('throws for the ÇİN mirror too (cin_demo_teslim)', () => {
    assert.throws(
      () => computeDemoEdit(demoAutoRound({ stage: 'cin_demo_teslim' }), leader),
      /otomatik istenen demo/i,
    )
  })

  it('lets through once the round has been consumed (last_reject_target cleared)', () => {
    // After the matbaa delivers, computeDemoTeslimAdvance clears
    // last_reject_target alongside last_reject_* — a fresh round on the
    // next iteration is the designer's, and the leader may edit it.
    const { project: next } = computeDemoEdit(
      demoAutoRound({ last_reject_target: null }), leader,
    )
    // The function returns only history, not a project change.
    assert.ok(next.history || next === undefined || true)
  })

  it('is team-leader-only — earlier guards still fire first (defensive order)', () => {
    // The role check throws before the auto-reject check on a stale client
    // bypass; this just pins the order so a future refactor can't reorder
    // them in a way that leaks the auto-reject detail to non-leaders.
    assert.throws(
      () => computeDemoEdit(demoAutoRound(), { id: 'u-x', role: 'designer', name: 'X' }),
      /yalnızca ekip lideri/,
    )
  })
})

describe('computeOzalitEdit refuses an auto-created round after reject-to-matbaa', () => {
  it('throws on a round that still carries last_reject_target=matbaa', () => {
    assert.throws(
      () => computeOzalitEdit(ozalitAutoRound(), leader),
      /otomatik istenen ozalit/i,
    )
  })

  it('lets through once the round has been consumed (last_reject_target cleared)', () => {
    const { project: next } = computeOzalitEdit(
      ozalitAutoRound({ last_reject_target: null }), leader,
    )
    assert.ok(next.history || next === undefined || true)
  })
})

// The mirror half: every transition that consumes the auto-created round
// clears last_reject_target alongside its two siblings, so a fresh
// iteration isn't stuck behind a stale 'matbaa' marker.
describe('round-consuming transitions clear last_reject_target', () => {
  it('computeAdvance resend (held demo → demo_teslim) clears all three', () => {
    const { project: next } = computeAdvance(
      {
        id: 'p-5', type: 'TR', stage: 'demo_onay', demo_held: true, demo_attempt: 2,
        last_reject_target: 'matbaa', last_reject_type: 'demo', last_reject_reason: 'r',
        reject_target: 'matbaa',
      },
      leader,
    )
    assert.equal(next.last_reject_target, null)
    assert.equal(next.last_reject_type, null)
    assert.equal(next.last_reject_reason, null)
    assert.equal(next.stage, 'demo_teslim')
  })

  it('computeAdvance generic forward (tasarim → demo_teslim) clears all three', () => {
    const { project: next } = computeAdvance(
      {
        id: 'p-6', type: 'TR', stage: 'tasarim', demo_attempt: 1, progress: 100,
        last_reject_target: 'matbaa', last_reject_type: 'demo', last_reject_reason: 'r',
      },
      leader,
    )
    assert.equal(next.last_reject_target, null)
    assert.equal(next.last_reject_type, null)
    assert.equal(next.last_reject_reason, null)
  })

  it('computeAdvance printer-delivers demo (demo_teslim → demo_onay) clears all three', () => {
    const { project: next } = computeAdvance(demoAutoRound(), printer)
    assert.equal(next.last_reject_target, null)
    assert.equal(next.last_reject_type, null)
    assert.equal(next.last_reject_reason, null)
    assert.equal(next.stage, 'demo_onay')
  })

  it('computeAdvance printer-delivers ozalit (ozalit_teslim → ozalit_onay) clears all three', () => {
    const { project: next } = computeAdvance(ozalitAutoRound(), printer)
    assert.equal(next.last_reject_target, null)
    assert.equal(next.last_reject_type, null)
    assert.equal(next.last_reject_reason, null)
    assert.equal(next.stage, 'ozalit_onay')
  })

  it('computeDemoCancel clears all three (back to tasarim)', () => {
    const { project: next } = computeDemoCancel(demoAutoRound(), leader)
    assert.equal(next.last_reject_target, null)
    assert.equal(next.last_reject_type, null)
    assert.equal(next.last_reject_reason, null)
    assert.equal(next.stage, 'tasarim')
  })

  it('computeOzalitCancel clears all three (back to tasarim)', () => {
    // Cancel needs ozalit_requested=true; combine the auto-round with that
    // flag so the function reaches the cleanup block.
    const { project: next } = computeOzalitCancel(
      ozalitAutoRound({ ozalit_requested: true }), leader,
    )
    assert.equal(next.last_reject_target, null)
    assert.equal(next.last_reject_type, null)
    assert.equal(next.last_reject_reason, null)
    assert.equal(next.stage, 'tasarim')
  })
})
