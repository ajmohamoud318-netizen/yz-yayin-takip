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
  it('bumps demo_attempt like a designer reject (new numbered attempt)', () => {
    const { project: next } = computeRejection(
      demoProject(), 'matbaa yeniden bassın', [], 'matbaa', ctx,
    )
    assert.equal(next.stage, 'demo_teslim')       // back to the matbaa
    assert.equal(next.reject_target, 'matbaa')
    assert.equal(next.demo_attempt, 6)            // bumped — same as designer
  })

  it('leaves subtasks untouched on a matbaa reject (design unchanged)', () => {
    const { project: next } = computeRejection(
      demoProject(), 'matbaa yeniden bassın', [], 'matbaa', ctx,
    )
    // No subtask was flagged for revision — the design didn't change.
    assert.ok(!(next.subtasks ?? []).some((s) => s.needs_revize))
  })

  it('reject-to-designer also bumps demo_attempt (genuine redesign)', () => {
    const { project: next } = computeRejection(
      demoProject(), 'tasarım değişsin', ['s1'], 'designer', ctx,
    )
    assert.equal(next.stage, 'tasarim')
    assert.equal(next.demo_attempt, 6)            // bumped
  })
})

// Regression: a reject used to leave demo_started (and the change-request/
// fix-pending ledger) stuck true from the PREVIOUS round. The matbaa's
// "İşlemi Başlatın" button never came back for the new round
// (canMarkDemoStarted requires !demo_started) while the leader/designer saw
// "Değişiklik İste" instead of a free cancel/edit (canRequestDemoChange
// requires demo_started) — for a round that hadn't even been redelivered yet.
describe('reject resets the matbaa "Başladım" ledger for a fresh round', () => {
  const startedProject = () => demoProject({
    demo_started: true,
    demo_started_at: '2026-01-01T00:00:00.000Z',
    demo_started_by: 'u-p',
    demo_started_by_name: 'Oktay',
    demo_change_requested_at: '2026-01-02T00:00:00.000Z',
    demo_change_requested_by: 'u-l',
    demo_change_requested_by_name: 'Ayşenur',
    demo_change_requested_note: 'renk yanlış',
    demo_fix_pending: true,
  })

  it('reject-to-designer clears demo_started/change-request/fix_pending', () => {
    const { project: next } = computeRejection(
      startedProject(), 'tasarım değişsin', ['s1'], 'designer', ctx,
    )
    assert.equal(next.demo_started, false)
    assert.equal(next.demo_started_at, null)
    assert.equal(next.demo_started_by, null)
    assert.equal(next.demo_started_by_name, null)
    assert.equal(next.demo_change_requested_at, null)
    assert.equal(next.demo_change_requested_by, null)
    assert.equal(next.demo_change_requested_by_name, null)
    assert.equal(next.demo_change_requested_note, null)
    assert.equal(next.demo_fix_pending, false)
  })

  it('reject-to-matbaa (re-delivery) also clears demo_started/change-request/fix_pending', () => {
    const { project: next } = computeRejection(
      startedProject(), 'matbaa yeniden bassın', [], 'matbaa', ctx,
    )
    assert.equal(next.stage, 'demo_teslim')
    assert.equal(next.demo_started, false)
    assert.equal(next.demo_change_requested_at, null)
    assert.equal(next.demo_fix_pending, false)
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
