/**
 * Demo flow rules: matbaa re-delivery numbering + re-send gating.
 *
 *   • Reject-to-matbaa re-delivers the SAME demo (design unchanged) and must
 *     NOT bump the attempt counter — only reject-to-designer starts a new one.
 *   • A demo re-send ("Demo İste") is only valid on a HELD demo. A demo still
 *     with the matbaa, or freshly delivered and awaiting the leader's decision,
 *     is in progress and must not be duplicated.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeAdvance, computeApproval, computeDemoReceive, computeRejection } from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }
const ctx = { actorName: leader.name, actor: leader }

function demoProject(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_onay',
    demo_attempt: 5, ozalit_attempt: 0,
    reject_target: null, ozalit_requested: false,
    demo_held: false,
    assignees: [{ id: 'u-d', name: 'Aylin' }],
    subtasks: [{ id: 's1', kind: 'check', is_done: true }],
    ...overrides,
  }
}

describe('reject-to-matbaa numbering', () => {
  it('does NOT bump demo_attempt (same demo re-delivered)', () => {
    const { project: next } = computeRejection(
      demoProject(), 'matbaa yeniden bassın', [], 'matbaa', ctx,
    )
    assert.equal(next.stage, 'demo_teslim')       // back to the matbaa
    assert.equal(next.reject_target, 'matbaa')
    assert.equal(next.demo_attempt, 5)            // unchanged — not 6
  })

  it('reject-to-designer still bumps demo_attempt (genuine redesign)', () => {
    const { project: next } = computeRejection(
      demoProject(), 'tasarım değişsin', ['s1'], 'designer', ctx,
    )
    assert.equal(next.stage, 'tasarim')
    assert.equal(next.demo_attempt, 6)            // bumped
  })
})

describe('demo "Teslim Alındı" gate before Onay', () => {
  it('blocks the demo approve until the delivery is marked received', () => {
    assert.throws(
      () => computeApproval(demoProject({ demo_received: false, progress: 100 }), leader),
      /Teslim Alındı/,
    )
  })

  it('an assigned designer can mark the demo received', () => {
    const designer = { id: 'u-d', role: 'designer', name: 'Aylin' }
    const { project: next } = computeDemoReceive(
      demoProject({ demo_received: false }), designer, { designerIds: ['u-d'] },
    )
    assert.equal(next.demo_received, true)
    assert.equal(next.demo_received_by, 'Aylin')
  })

  it('a user who is neither leader nor assigned designer cannot mark it received', () => {
    const stranger = { id: 'u-x', role: 'designer', name: 'Biri' }
    assert.throws(
      () => computeDemoReceive(demoProject(), stranger, { designerIds: ['u-d'] }),
      /yalnızca ekip lideri veya atanmış tasarımcı/,
    )
  })

  it('approves and advances once received at 100%', () => {
    const { project: next } = computeApproval(
      demoProject({ demo_received: true, progress: 100 }), leader,
    )
    assert.equal(next.stage, 'ozalit_teslim')
  })

  it('a fresh delivery resets the received flag', () => {
    // Matbaa delivers demo_teslim → demo_onay; the ack must not carry over.
    const printer = { id: 'u-p', role: 'printer', name: 'Oktay' }
    const { project: next } = computeAdvance(
      demoProject({ stage: 'demo_teslim', demo_received: true, progress: 100 }), printer,
    )
    assert.equal(next.stage, 'demo_onay')
    assert.equal(next.demo_received, false)
  })
})

describe('demo re-send gating (demo_held)', () => {
  it('blocks re-send when the demo is not held (in progress, awaiting decision)', () => {
    assert.throws(
      () => computeAdvance(demoProject({ demo_held: false }), leader),
      /Devam eden bir demo/,
    )
  })

  it('allows re-send when the demo is held (designer finished, sending next round)', () => {
    const { project: next } = computeAdvance(demoProject({ demo_held: true }), leader)
    assert.equal(next.stage, 'demo_teslim')       // new round goes to the matbaa
    assert.equal(next.demo_attempt, 6)            // this IS a new demo — bump
    assert.equal(next.demo_held, false)           // hold cleared
  })
})
