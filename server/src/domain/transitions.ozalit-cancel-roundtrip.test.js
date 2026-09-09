/**
 * Cancel an ozalit, get back to "Ozalit İsteyin".
 *
 * The question this answers end to end: a leader requests an ozalit, changes
 * their mind, cancels — can they request it again?
 *
 * Yes, in one press, and the stage never moves.
 *
 * Requesting an ozalit is not a stage change: the project is already at
 * `ozalit_teslim` (the demo approval put it there) and the leader's press only
 * flips `ozalit_requested`. So the exact undo is to flip it back — the same
 * shape as the demo leg, where cancelling returns you to the state you were in
 * before you asked with "Demo İsteyin" still on screen.
 *
 * Two earlier versions of this got it wrong, both by moving the stage. It first
 * read `stage: 'tasarim'`, copied from computeDemoCancel, which threw away a
 * fully approved demo over a mistaken click. The correction sent it to
 * `demo_onay` on the reasoning that ozalit is "requested from" there — but that
 * is where the project COMES from, and it left the project parked at a gate it
 * had already signed, needing an extra approve press just to get back.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeOzalitCancel } from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }
const SNAPSHOT = ['KUTU', 'KİTAP']
const signed = (parca) => ({ parca, id: leader.id, name: leader.name, at: '2026-09-08T09:00:00.000Z' })

/** A requested-but-unstarted ozalit on a project whose demo is fully signed. */
function ozalitRequested() {
  return {
    id: 'p-1', type: 'TR', stage: 'ozalit_teslim',
    progress: 100, demo_attempt: 2, ozalit_attempt: 0,
    ozalit_requested: true, ozalit_started: false,
    demo_received: true, demo_held: false,
    demo_parca_approvals: SNAPSHOT.map(signed),
    parca_state: SNAPSHOT.map((parca) => ({
      parca, gate: 'demo', state: 'pending',
      delivered_at: '2026-09-07T09:00:00.000Z', received_at: '2026-09-07T10:00:00.000Z',
    })),
    assignees: [{ id: 'u-d', name: 'Aylin' }],
    subtasks: [],
  }
}

describe('cancel an ozalit, then request it again', () => {
  it('stays at ozalit_teslim — the stage never moved to make the request', () => {
    const { project: cancelled } = computeOzalitCancel(ozalitRequested(), leader)
    assert.equal(cancelled.stage, 'ozalit_teslim')
  })

  it('leaves it immediately requestable again', () => {
    // `ozalit_requested` false with no matbaa lock is exactly what
    // availableActions needs to offer "Ozalit İsteyin"
    // (project-detail.js, the ozalit_teslim two-step handoff). No intervening
    // press of anything.
    const { project: cancelled } = computeOzalitCancel(ozalitRequested(), leader)
    assert.equal(cancelled.ozalit_requested, false)
    assert.equal(cancelled.reject_target ?? null, null)
  })

  it('keeps the approved demo untouched', () => {
    // It was approved and it still is; the ozalit click had nothing to do with
    // it. This is what the original `stage: 'tasarim'` destroyed.
    const { project: cancelled } = computeOzalitCancel(ozalitRequested(), leader)
    assert.deepEqual(cancelled.demo_parca_approvals.map((r) => r.parca), SNAPSHOT)
    assert.equal(cancelled.demo_received, true)
  })

  it('does not bump either attempt counter', () => {
    // Nothing was delivered and nothing was re-approved; renumbering would
    // strand the spec sheets those numbers resolve.
    const { project: cancelled } = computeOzalitCancel(ozalitRequested(), leader)
    assert.equal(cancelled.ozalit_attempt, 0)
    assert.equal(cancelled.demo_attempt, 2)
  })

  it('can be requested and cancelled again, repeatedly', () => {
    // The round trip has to be a loop, not a one-way door with a reset button.
    let project = ozalitRequested()
    for (let i = 0; i < 3; i += 1) {
      const { project: cancelled } = computeOzalitCancel(project, leader)
      assert.equal(cancelled.stage, 'ozalit_teslim')
      assert.equal(cancelled.ozalit_requested, false)
      project = { ...cancelled, ozalit_requested: true }
    }
  })
})
