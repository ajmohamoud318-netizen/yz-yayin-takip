/**
 * "Teslim Alınamadı" must not throw away a round the leader is halfway through.
 *
 * Reported from live testing on a 3-parça project: approve KUTU and KİTAP,
 * reject KILAVUZ to the matbaa, take the reprint back, press "Teslim Alınamadı"
 * — and both approvals were gone, the attempt bumped, and the whole round back
 * with the matbaa reprinting two parçalar nobody had complained about.
 *
 * The cause is a premise that per-parça routing quietly broke. The reset inside
 * computeDemoNotReceived reasons: "any rows in here were signed on an EARLIER
 * round (the approve gate requires demo_received, which is false by definition
 * here)". That held while the ONLY way to reach demo_onay with
 * `demo_received === false` was a fresh whole-round delivery. It stopped holding
 * when `settleParcaAtGate` (services/parca-service.js) started clearing the same
 * flag for a SINGLE parça handed back at this gate — which is how the leader is
 * asked to acknowledge that one reprint.
 *
 * So the flag can no longer tell "nothing has been decided yet" from "one parça
 * came back mid-decision". The ledger can, and that is what these pin.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeDemoNotReceived, computeOzalitNotReceived } from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }
const signed = (parca) => ({ parca, id: leader.id, name: leader.name, at: '2026-09-08T09:00:00.000Z' })

/** The trace a per-parça redelivery leaves: back at the gate, unacknowledged. */
const returned = (parca, gate) => ({
  parca, gate, state: 'pending', owner_role: null,
  delivered_at: '2026-09-08T11:00:00.000Z', received_at: null,
})

function demoOnay(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_onay',
    demo_attempt: 2, demo_received: false,
    assignees: [{ id: 'u-d', name: 'Aylin' }],
    demo_parca_approvals: [],
    parca_state: [returned('KILAVUZ', 'demo')],
    ...overrides,
  }
}

describe('demo "Teslim Alınamadı" on a partly-approved round', () => {
  it('refuses rather than wiping the sign-offs already given', () => {
    assert.throws(
      () => computeDemoNotReceived(
        demoOnay({ demo_parca_approvals: [signed('KUTU'), signed('KİTAP')] }),
        leader,
      ),
      /bazı parçaları onaylandı/,
    )
  })

  it('points at the action that means what they wanted', () => {
    assert.throws(
      () => computeDemoNotReceived(
        demoOnay({ demo_parca_approvals: [signed('KUTU')] }),
        leader,
      ),
      /tek tek reddedin/,
    )
  })

  it('still works on a genuinely fresh delivery — nothing signed yet', () => {
    // The case it was written for: the whole round arrived, nobody has decided
    // anything, and it did not physically turn up.
    const { project: next } = computeDemoNotReceived(demoOnay(), leader)
    assert.equal(next.stage, 'demo_teslim')
    assert.equal(next.demo_attempt, 3)
    assert.deepEqual(next.demo_parca_approvals, [])
  })

  it('bounces the ÇİN leg to cin_demo_teslim as before', () => {
    const { project: next } = computeDemoNotReceived(
      demoOnay({ type: 'CIN', stage: 'cin_demo_onay' }), leader,
    )
    assert.equal(next.stage, 'cin_demo_teslim')
  })
})

describe('ozalit "Teslim Alınamadı" — the same rule, object-shaped ledger', () => {
  function ozalitOnay(overrides = {}) {
    return {
      id: 'p-2', type: 'TR', stage: 'ozalit_onay',
      ozalit_attempt: 1, ozalit_received: false, ekran_ozalit: false,
      last_reject_type: null,
      assignees: [{ id: 'u-d', name: 'Aylin' }],
      ozalit_parca_approvals: {},
      parca_state: [returned('KILAVUZ', 'ozalit')],
      ...overrides,
    }
  }

  it('refuses on a partly-approved round', () => {
    assert.throws(
      () => computeOzalitNotReceived(
        ozalitOnay({ ozalit_parca_approvals: { KUTU: [{ id: leader.id }] } }),
        leader,
      ),
      /bazı parçaları onaylandı/,
    )
  })

  it('still works on a fresh delivery', () => {
    const { project: next } = computeOzalitNotReceived(ozalitOnay(), leader)
    assert.equal(next.stage, 'ozalit_teslim')
  })
})

/**
 * The half that keeps the reset working where it was written to.
 *
 * A non-empty ledger on its own is the LEGITIMATE case: a held demo carries
 * sign-offs given at <100%, and a proof that never physically turned up must not
 * arrive pre-approved (transitions.demo.test.js, transitions.ozalit.test.js).
 * What marks the broken case is a parça sitting at the gate delivered and
 * unacknowledged — the trace of the redelivery that cleared the receipt.
 */
describe('the guard stays out of the way of a genuine non-delivery', () => {
  it('still resets a held round with signatures but nothing returned', () => {
    const { project: next } = computeDemoNotReceived(
      demoOnay({
        demo_held: true,
        demo_parca_approvals: [signed('KUTU')],
        parca_state: [],
      }),
      leader,
    )
    assert.equal(next.stage, 'demo_teslim')
    assert.deepEqual(next.demo_parca_approvals, [], 'the redelivery must need fresh signatures')
  })

  it('ignores a returned parça on the OTHER gate', () => {
    // Same parça names on both legs; an ozalit row says nothing about a demo
    // round's arrival.
    const { project: next } = computeDemoNotReceived(
      demoOnay({
        demo_parca_approvals: [signed('KUTU')],
        parca_state: [returned('KILAVUZ', 'ozalit')],
      }),
      leader,
    )
    assert.equal(next.stage, 'demo_teslim')
  })

  it('ignores a row that has already been acknowledged', () => {
    const { project: next } = computeDemoNotReceived(
      demoOnay({
        demo_parca_approvals: [signed('KUTU')],
        parca_state: [{
          ...returned('KILAVUZ', 'demo'), received_at: '2026-09-08T12:00:00.000Z',
        }],
      }),
      leader,
    )
    assert.equal(next.stage, 'demo_teslim')
  })
})
