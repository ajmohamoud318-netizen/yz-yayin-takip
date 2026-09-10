/**
 * The whole-sheet "Teslim Edin" on a round that is split into parçalar.
 *
 * Migration 074 let the matbaa deliver a multi-parça round one parça at a time,
 * and `deliverParca` keeps the project at its *_teslim stage until the last one
 * lands — `allParcalarDelivered` (services/parca-service.js) is what lets the
 * stage follow the final delivery.
 *
 * The project-level advance never learned any of that. It moved the project to
 * its onay stage in one step regardless, so a printer who pressed the
 * whole-sheet button carried the round past parçalar nobody had produced: their
 * `parca_state` rows stayed at `with_matbaa`, the leader was never asked to
 * receive them, and the matbaa's own queue kept offering parça jobs on a project
 * that had already moved on. The client stopped drawing that button (every
 * printer surface renders ParcaJobBoard now), which left the API as the only
 * remaining way in. This closes it.
 *
 * The two halves of the delivery must agree exactly, or the last parça's own
 * advance — `deliverParca` calls `advanceProject` in the same transaction —
 * would refuse itself and the project would never leave the stage.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeAdvance } from './transitions.js'

const printer = { id: 'u-m', role: 'printer', name: 'Matbaa' }
const PARCALAR = ['KAPAK', 'KUTU']

// `gate` defaults to 'demo' — the demo describe block below is most of this
// file's cases. The ozalit block passes 'ozalit' explicitly: parcalarStillOwed
// now scopes its read to the round's own gate (a same-named row left over
// from the OTHER leg no longer counts as this round's), so a row built for
// the wrong gate would silently read as "never touched" again.
const row = (parca, state, gate = 'demo') => ({
  parca, gate, state, owner_role: 'printer', attempt: 1,
  delivered_at: state === 'pending' ? '2026-09-08T09:00:00.000Z' : null,
  received_at: null,
})

function demoTeslim(overrides = {}) {
  return {
    id: 'p-1', title: 'Kitap', type: 'TR', stage: 'demo_teslim', origin: null,
    progress: 100, demo_attempt: 0, assignees: [], subtasks: [],
    demo_started: true, demo_change_requested_at: null,
    ...overrides,
  }
}

function ozalitTeslim(overrides = {}) {
  return {
    id: 'p-2', title: 'Kitap', type: 'TR', stage: 'ozalit_teslim', origin: null,
    progress: 100, ozalit_attempt: 0, assignees: [], subtasks: [],
    ozalit_requested: true, ozalit_started: true, ozalit_change_requested_at: null,
    ...overrides,
  }
}

const advance = (project) => computeAdvance(project, printer, {})

describe('demo_teslim — whole-sheet delivery on a split round', () => {
  it('refuses while a parça has never been touched', () => {
    // The case that shipped broken: a fresh two-parça round materialises no
    // parca_state rows at all, so the rows alone say "nothing is out".
    assert.throws(
      () => advance(demoTeslim({ round_parcalar: PARCALAR, parca_state: [] })),
      /teslim edilmemiş parçaları var/,
    )
  })

  it('names the parçalar it is waiting on', () => {
    assert.throws(
      () => advance(demoTeslim({
        round_parcalar: PARCALAR,
        parca_state: [row('KAPAK', 'pending'), row('KUTU', 'with_matbaa')],
      })),
      /KUTU/,
    )
  })

  it('refuses while a parça is started but not handed back', () => {
    assert.throws(
      () => advance(demoTeslim({
        round_parcalar: PARCALAR,
        parca_state: [row('KAPAK', 'pending'), row('KUTU', 'in_round')],
      })),
      /teslim edilmemiş parçaları var/,
    )
  })

  it('allows it once every parça has been delivered', () => {
    // This is the state deliverParca leaves behind before it calls
    // advanceProject for the last parça — the guard must not refuse that.
    const result = advance(demoTeslim({
      round_parcalar: PARCALAR,
      parca_state: [row('KAPAK', 'pending'), row('KUTU', 'pending')],
    }))
    assert.equal(result.project.stage, 'demo_onay')
  })

  it('allows it on a round whose parçalar were signed off on a previous round', () => {
    // parca_state rows outlive their round (they are never set to 'approved'),
    // so a later whole-sheet round meets rows left at 'pending'. Those are not
    // owed and must not block.
    const result = advance(demoTeslim({
      demo_attempt: 1,
      round_parcalar: PARCALAR,
      parca_state: [row('KAPAK', 'pending'), row('KUTU', 'pending')],
    }))
    assert.equal(result.project.stage, 'demo_onay')
  })
})

describe('rounds that are not split are untouched', () => {
  it('allows a single-parça round with no rows', () => {
    // deriveTeslimParcalar skips a one-parça sheet, so it has no per-parça
    // queue and the whole sheet is the only unit there is.
    const result = advance(demoTeslim({ round_parcalar: ['KAPAK'], parca_state: [] }))
    assert.equal(result.project.stage, 'demo_onay')
  })

  it('allows a round with no snapshot at all', () => {
    const result = advance(demoTeslim({ round_parcalar: [], parca_state: [] }))
    assert.equal(result.project.stage, 'demo_onay')
  })

  it('allows a project that predates per-parça routing entirely', () => {
    // No round_parcalar key, no parca_state key — every project from before
    // migration 074, and the shape every existing unit test builds.
    const result = advance(demoTeslim())
    assert.equal(result.project.stage, 'demo_onay')
  })
})

describe('ozalit_teslim — the same rule', () => {
  it('refuses a split round', () => {
    assert.throws(
      () => advance(ozalitTeslim({
        round_parcalar: PARCALAR,
        parca_state: [row('KAPAK', 'pending', 'ozalit'), row('KUTU', 'with_matbaa', 'ozalit')],
      })),
      /teslim edilmemiş parçaları var/,
    )
  })

  it('allows a fully delivered one', () => {
    const result = advance(ozalitTeslim({
      round_parcalar: PARCALAR,
      parca_state: [row('KAPAK', 'pending', 'ozalit'), row('KUTU', 'pending', 'ozalit')],
    }))
    assert.equal(result.project.stage, 'ozalit_onay')
  })

  // A same-named row left over from the demo round that already finished
  // must not count for the ozalit round just because the parça name matches —
  // see parcalarStillOwed's gate scoping.
  it('does not accept a same-named demo-gate row in place of an ozalit delivery', () => {
    assert.throws(
      () => advance(ozalitTeslim({
        round_parcalar: PARCALAR,
        parca_state: [row('KAPAK', 'pending', 'demo'), row('KUTU', 'pending', 'demo')],
      })),
      /teslim edilmemiş parçaları var/,
    )
  })

  it('leaves the leader’s "Ozalit İste" step alone', () => {
    // That branch runs before the guard and belongs to a different actor — the
    // round is not with the matbaa yet, so it has no parçalar to owe.
    const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }
    const project = ozalitTeslim({
      ozalit_requested: false, ozalit_started: false,
      round_parcalar: PARCALAR, parca_state: [],
    })
    const result = computeAdvance(project, leader, {})
    assert.equal(result.project.ozalit_requested, true)
    assert.equal(result.project.stage, 'ozalit_teslim')
  })
})
