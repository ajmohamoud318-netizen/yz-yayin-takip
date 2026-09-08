/**
 * The per-parça change-request handshake (migration 077).
 *
 * The bug this closes: correcting a sheet the matbaa holds has always had two
 * modes chosen by `projects.demo_started` — free edit while they haven't
 * started, ask/accept/decline once they have. On a round split into parçalar
 * that flag is NEVER set (`startParca` leaves it alone on purpose, so one
 * started parça doesn't hide "İşlemi Başlatın" on the rest), so the free edit
 * stayed open over a parça already on the press and the ask was unreachable.
 *
 * Two halves are pinned here:
 *
 *   • computeDemoEdit / computeOzalitEdit refuse a sheet-wide edit while any
 *     parça of the round is started and unreleased, and name which.
 *   • The edit that IS allowed settles the correction debt an accepted request
 *     left behind, through the third write path (`parcaState`).
 *
 * The patch shapes themselves live in parca-routing.test.js.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  computeDemoEdit, computeOzalitEdit,
  computeDemoCancel, computeOzalitCancel,
} from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }

/** A parça row in whatever state the test needs; defaults to untouched. */
function row(parca, overrides = {}) {
  return {
    parca, gate: 'demo', state: 'with_matbaa', owner_role: 'printer',
    attempt: 1, started_at: null, delivered_at: null, received_at: null,
    change_requested_at: null, fix_pending: false,
    ...overrides,
  }
}

function demoRound(parcaState) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_teslim',
    demo_attempt: 2, demo_started: false, demo_held: false,
    last_reject_target: null,
    parca_state: parcaState,
  }
}

function ozalitRound(parcaState) {
  return {
    id: 'p-2', type: 'TR', stage: 'ozalit_teslim', progress: 100,
    ozalit_attempt: 1, ozalit_requested: true, ozalit_started: false,
    last_reject_target: null,
    parca_state: parcaState,
  }
}

describe('computeDemoEdit refuses a sheet-wide edit over a started parça', () => {
  it('throws when one parça of the round is on the press', () => {
    const project = demoRound([
      row('KUTU', { state: 'in_round', started_at: '2026-09-01T10:00:00Z' }),
      row('KİTAP'),
    ])
    assert.throws(
      () => computeDemoEdit(project, leader),
      /Matbaa şu parçalara başladı: KUTU/,
    )
  })

  it('names every locked parça, not just the first', () => {
    const project = demoRound([
      row('KUTU', { state: 'in_round', started_at: '2026-09-01T10:00:00Z' }),
      row('KİTAP', { state: 'in_round', started_at: '2026-09-01T11:00:00Z' }),
      row('KILAVUZ'),
    ])
    assert.throws(() => computeDemoEdit(project, leader), /KUTU, KİTAP/)
  })

  it('allows the edit when no parça has been started', () => {
    const project = demoRound([row('KUTU'), row('KİTAP')])
    const { project: next } = computeDemoEdit(project, leader)
    assert.equal(next.demo_fix_pending, false)
  })

  it('allows the edit with no parça rows at all — rows only exist once acted on', () => {
    const { history } = computeDemoEdit(demoRound([]), leader)
    assert.equal(history.event, 'demo_form_edited')
  })

  it('allows the edit once an accepted request released the parça', () => {
    // What parcaChangeAcceptPatch leaves behind: un-started, back at
    // with_matbaa, carrying the correction debt.
    const project = demoRound([
      row('KUTU', { fix_pending: true }),
      row('KİTAP'),
    ])
    const { history } = computeDemoEdit(project, leader)
    assert.equal(history.event, 'demo_form_edited')
  })

  it('settles the correction debt on exactly the parçalar that owed one', () => {
    const project = demoRound([
      row('KUTU', { fix_pending: true }),
      row('KİTAP'),
    ])
    const { parcaState } = computeDemoEdit(project, leader)
    assert.equal(parcaState.length, 1)
    assert.equal(parcaState[0].parca, 'KUTU')
    assert.equal(parcaState[0].patch.fix_pending, false)
  })

  it('writes no parça rows when nothing owed a correction', () => {
    const { parcaState } = computeDemoEdit(demoRound([row('KUTU')]), leader)
    assert.deepEqual(parcaState, [])
  })

  it('keeps the project-level guard ahead of the parça one', () => {
    // A legacy whole-sheet round has no parça rows and must still be refused
    // by the flag it has always been refused by.
    const project = demoRound([])
    project.demo_started = true
    assert.throws(() => computeDemoEdit(project, leader), /değişiklik isteyin/)
  })
})

describe('computeOzalitEdit carries the same per-parça guard', () => {
  it('throws when one parça of the round is on the press', () => {
    const project = ozalitRound([
      row('KAPAK', { gate: 'ozalit', state: 'in_round', started_at: '2026-09-01T10:00:00Z' }),
      row('İÇ', { gate: 'ozalit' }),
    ])
    assert.throws(
      () => computeOzalitEdit(project, leader),
      /Matbaa şu parçalara başladı: KAPAK/,
    )
  })

  it('settles the correction debt on the released parça', () => {
    const project = ozalitRound([
      row('KAPAK', { gate: 'ozalit', fix_pending: true }),
    ])
    const { parcaState } = computeOzalitEdit(project, leader)
    assert.deepEqual(parcaState.map((p) => p.parca), ['KAPAK'])
  })
})

describe('cancel carries the same per-parça guard as edit', () => {
  // The more destructive twin: cancel sends the project back to tasarim, so
  // withdrawing a round the matbaa is half way through printing is worse than
  // silently editing it — and it had the identical dead `demo_started` guard.
  it('refuses to withdraw a round with a parça on the press', () => {
    const project = demoRound([
      row('KUTU', { state: 'in_round', started_at: '2026-09-01T10:00:00Z' }),
      row('KİTAP'),
    ])
    assert.throws(
      () => computeDemoCancel(project, leader),
      /Matbaa şu parçalara başladı: KUTU/,
    )
  })

  it('still allows the cancel while the matbaa has started nothing', () => {
    const { project: next } = computeDemoCancel(demoRound([row('KUTU'), row('KİTAP')]), leader)
    assert.equal(next.stage, 'tasarim')
  })

  it('allows it once an accepted request released the parça', () => {
    const { project: next } = computeDemoCancel(demoRound([row('KUTU', { fix_pending: true })]), leader)
    assert.equal(next.stage, 'tasarim')
  })

  it('ozalit cancel refuses the same way', () => {
    const project = ozalitRound([
      row('KAPAK', { gate: 'ozalit', state: 'in_round', started_at: '2026-09-01T10:00:00Z' }),
    ])
    assert.throws(() => computeOzalitCancel(project, leader), /Matbaa şu parçalara başladı: KAPAK/)
  })
})
