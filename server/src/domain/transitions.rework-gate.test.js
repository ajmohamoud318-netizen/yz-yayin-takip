/**
 * Rework gate: a parça that is out with the designer or the matbaa may not be
 * approved, and the bulk shortcut must not sweep it up.
 *
 * A per-parça reject clears that parça's approval row — which is what holds the
 * project at its gate — but that also made it "pending", and pending is the set
 * "Tüm parçaları onaylayın" signs off. So the bulk click approved exactly the
 * parçalar the leader had just rejected and the project advanced with the
 * matbaa still holding one and the designer still holding another.
 *
 * The routing table (`project.parca_state`, migration 074) is the source of
 * truth here rather than the `*_parca_rejections` ledger: it returns a parça to
 * 'pending' the moment the rework lands, whereas the ledger is append-only.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeApproval } from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }
const designer = { id: 'u-d', role: 'designer', name: 'Aylin' }
const PARCALAR = ['KAPAK', 'KUTU', 'KILAVUZ']

function gateProject(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_onay', progress: 100,
    demo_attempt: 1, ozalit_attempt: 0, demo_held: false, demo_received: true,
    demo_parca_approvals: [], demo_parca_rejections: [],
    assignees: [{ id: 'u-d', name: 'Aylin' }],
    subtasks: [{ id: 's1', kind: 'check', is_done: true }],
    parca_state: [],
    ...overrides,
  }
}

const ctx = (extra = {}) => ({
  actorName: leader.name,
  actor: leader,
  snapshot: { selectedComponents: PARCALAR },
  ...extra,
})

/** KAPAK signed off; KUTU with the matbaa, KILAVUZ with the designer. */
function midRework(overrides = {}) {
  return gateProject({
    demo_parca_approvals: [
      { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: '2026-01-01T00:00:00.000Z' },
    ],
    parca_state: [
      { parca: 'KUTU', gate: 'demo', state: 'with_matbaa', owner_role: 'printer', attempt: 2 },
      { parca: 'KILAVUZ', gate: 'demo', state: 'with_designer', owner_role: 'designer', attempt: 2 },
    ],
    ...overrides,
  })
}

describe('parçalar out for rework are not approvable', () => {
  it('bulk approve refuses when every pending parça is out for rework', () => {
    assert.throws(
      () => computeApproval(midRework(), leader, ctx()),
      (err) => err.status === 400 && /revizede/i.test(err.message),
      'the bulk shortcut must not sign off parçalar sitting on someone else\'s desk',
    )
  })

  it('naming a parça that is out for rework is refused by name', () => {
    assert.throws(
      () => computeApproval(midRework(), leader, ctx({ parcalar: ['KUTU'] })),
      (err) => err.status === 400 && /KUTU/.test(err.message),
    )
  })

  it('bulk approve still signs off the parçalar that ARE at the gate', () => {
    // KILAVUZ came back from the designer (state back to 'pending'); KUTU is
    // still with the matbaa. The bulk click takes KILAVUZ and leaves KUTU.
    const p = midRework({
      parca_state: [
        { parca: 'KUTU', gate: 'demo', state: 'with_matbaa', owner_role: 'printer', attempt: 2 },
        { parca: 'KILAVUZ', gate: 'demo', state: 'pending', owner_role: null, attempt: 2 },
      ],
    })
    const { project: next } = computeApproval(p, leader, ctx())
    assert.equal(next.stage, 'demo_onay', 'KUTU is still owed, so the project holds')
    const signed = next.demo_parca_approvals.map((a) => a.parca)
    assert.deepEqual(signed.sort(), ['KAPAK', 'KILAVUZ'], 'only the parça at the gate got signed')
  })

  it('advances once the last parça is back and approved', () => {
    const p = midRework({
      demo_parca_approvals: [
        { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: '2026-01-01T00:00:00.000Z' },
        { parca: 'KILAVUZ', by: 'u-l', by_name: 'Ayşenur', at: '2026-01-01T00:00:00.000Z' },
      ],
      parca_state: [
        { parca: 'KUTU', gate: 'demo', state: 'pending', owner_role: null, attempt: 2 },
        { parca: 'KILAVUZ', gate: 'demo', state: 'pending', owner_role: null, attempt: 2 },
      ],
    })
    const { project: next } = computeApproval(p, leader, ctx())
    assert.equal(next.stage, 'ozalit_teslim')
  })

  it('a project with no routing rows behaves exactly as it did pre-074', () => {
    const { project: next } = computeApproval(gateProject(), leader, ctx())
    assert.equal(next.stage, 'ozalit_teslim', 'nothing is out for rework, so all three sign off')
  })

  it('the ozalit gate applies the same rule', () => {
    const p = gateProject({
      stage: 'ozalit_onay', ozalit_received: true,
      ozalit_parca_approvals: {}, ozalit_parca_rejections: [],
      parca_state: [
        { parca: 'KUTU', gate: 'ozalit', state: 'with_matbaa', owner_role: 'printer', attempt: 2 },
      ],
    })
    assert.throws(
      () => computeApproval(p, leader, ctx({ parcalar: ['KUTU'], teamLeaderIds: ['u-l'], designerIds: ['u-d'] })),
      (err) => err.status === 400 && /revizede/i.test(err.message),
    )
    // The parçalar that ARE at the gate stay approvable in the same round.
    const { project: next } = computeApproval(
      p, leader, ctx({ parcalar: ['KAPAK'], teamLeaderIds: ['u-l'], designerIds: ['u-d'] }),
    )
    assert.equal(next.stage, 'ozalit_onay')
    assert.ok(next.ozalit_parca_approvals.KAPAK?.length === 1)
    assert.equal(designer.role, 'designer') // keeps the fixture honest about who is required
  })
})
