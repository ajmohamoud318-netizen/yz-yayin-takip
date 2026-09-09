/**
 * The whole-round "Teslim Alındı" and the routing rows it covers.
 *
 * One receipt at the gate takes delivery of every parça of the round — they
 * arrived together, because the stage only reaches *_onay once the matbaa has
 * delivered all of them (assertRoundFullyDelivered). It never said so in the
 * rows: the receipt verbs loaded no `parca_state`, so a parça acknowledged
 * individually at *_teslim carried a `received_at` while one covered by the
 * project-level receipt did not — the same event recorded two different ways
 * depending on which button reached it.
 *
 * Nothing at the onay gate reads those stamps today (`parcaDecidable` and
 * `parcaAwaitsReceipt` are consulted only at the EARLY_PARCA_GATES), so this
 * fixes a record rather than a behaviour — which is the reason to fix it. A
 * half-written row is a trap for the next gate that decides to trust it.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeDemoReceive, computeOzalitReceive } from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }
const DELIVERED = '2026-09-08T09:00:00.000Z'

/** A parça the matbaa handed back, not yet acknowledged. */
const delivered = (parca, gate) => ({
  parca, gate, state: 'pending', owner_role: null,
  delivered_at: DELIVERED, received_at: null,
})

function demoOnay(parcaState) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_onay',
    demo_received: false, progress: 100,
    assignees: [{ id: 'u-d', name: 'Aylin' }],
    parca_state: parcaState,
  }
}

describe('demo "Teslim Alındı" stamps the rows it covers', () => {
  it('acknowledges every delivered parça of the round', () => {
    const result = computeDemoReceive(
      demoOnay([delivered('KUTU', 'demo'), delivered('KİTAP', 'demo')]),
      leader,
    )
    assert.deepEqual(result.parcaState.map((p) => p.parca), ['KUTU', 'KİTAP'])
    for (const { patch } of result.parcaState) {
      assert.ok(patch.received_at, 'stamped')
      assert.equal(patch.received_by, leader.id)
      assert.equal(patch.received_by_name, leader.name)
    }
  })

  it('keeps the delivery stamp it is acknowledging', () => {
    // upsertParcaState writes the delivery stamps verbatim, so a patch that
    // dropped delivered_at would erase the very delivery being acknowledged.
    const result = computeDemoReceive(demoOnay([delivered('KUTU', 'demo')]), leader)
    assert.equal(result.parcaState[0].patch.delivered_at, DELIVERED)
  })

  it('leaves a parça that was already received alone', () => {
    // Somebody took delivery of KUTU on its own at demo_teslim. That is their
    // receipt, with their name and their timestamp — the round's must not
    // overwrite it.
    const already = {
      ...delivered('KUTU', 'demo'),
      received_at: '2026-09-07T08:00:00.000Z',
      received_by_name: 'Oktay',
    }
    const result = computeDemoReceive(
      demoOnay([already, delivered('KİTAP', 'demo')]),
      leader,
    )
    assert.deepEqual(result.parcaState.map((p) => p.parca), ['KİTAP'])
  })

  it('ignores rows belonging to the other gate', () => {
    // Same parça names on both legs; an ozalit row is not this demo receipt's
    // business.
    const result = computeDemoReceive(
      demoOnay([delivered('KUTU', 'demo'), delivered('KUTU', 'ozalit')]),
      leader,
    )
    assert.equal(result.parcaState.length, 1)
    assert.equal(result.parcaState[0].patch.received_at != null, true)
  })

  it('is null when there is nothing to stamp', () => {
    // A single-parça or legacy round materialises no routing rows at all. The
    // service skips the write path entirely on null.
    assert.equal(computeDemoReceive(demoOnay([]), leader).parcaState, null)
    assert.equal(computeDemoReceive(demoOnay(undefined), leader).parcaState, null)
  })

  it('still sets the project-level receipt, unchanged', () => {
    const { project: next } = computeDemoReceive(
      demoOnay([delivered('KUTU', 'demo')]), leader,
    )
    assert.equal(next.demo_received, true)
    assert.equal(next.demo_received_by, leader.name)
  })

  it('stays idempotent — a second acknowledgment writes nothing', () => {
    const project = { ...demoOnay([delivered('KUTU', 'demo')]), demo_received: true }
    const result = computeDemoReceive(project, leader)
    assert.equal(result.history, null)
  })
})

describe('ozalit "Teslim Alındı" — the same', () => {
  function ozalitOnay(parcaState) {
    return {
      id: 'p-2', type: 'TR', stage: 'ozalit_onay',
      ozalit_received: false, ekran_ozalit: false, last_reject_type: null,
      assignees: [{ id: 'u-d', name: 'Aylin' }],
      parca_state: parcaState,
    }
  }

  it('stamps its own gate’s rows', () => {
    const result = computeOzalitReceive(
      ozalitOnay([delivered('KUTU', 'ozalit'), delivered('KUTU', 'demo')]),
      leader,
    )
    assert.equal(result.parcaState.length, 1, 'the demo-gate row is not this receipt’s')
    assert.ok(result.parcaState[0].patch.received_at)
    assert.equal(result.project.ozalit_received, true)
  })
})
