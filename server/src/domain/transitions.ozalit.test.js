/**
 * Multi-party ozalit approval.
 *
 * Every active team leader AND every assigned designer must approve before the
 * project advances from ozalit_onay → uretime_hazir. Only a team leader may
 * reject; a single rejection sends it back. Since migration 035 the whole round
 * is gated on the proof being marked "Teslim Alındı" first, so the fixture
 * below starts acknowledged — the gate itself is covered separately.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  computeAdvance, computeApproval, computeOzalitReceive, computeRejection,
} from './transitions.js'

const L1 = { id: 'L1', role: 'team_leader', name: 'Ayşenur' }
const L2 = { id: 'L2', role: 'team_leader', name: 'İkinci Lider' }
const D1 = { id: 'D1', role: 'designer', name: 'Abdijibar' }
const printer = { id: 'P1', role: 'printer', name: 'Oktay' }

const ctx = { teamLeaderIds: ['L1', 'L2'], designerIds: ['D1'] }

function ozalitProject(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'ozalit_onay', progress: 100,
    ozalit_approvals: [], ozalit_attempt: 0, ozalit_received: true,
    ...overrides,
  }
}

describe('multi-party ozalit approval', () => {
  it('a single approval is recorded but does NOT advance', () => {
    const { project: next } = computeApproval(ozalitProject(), L1, ctx)
    assert.equal(next.stage, 'ozalit_onay')           // still waiting
    assert.equal(next.ozalit_approvals.length, 1)
    assert.equal(next.ozalit_approvals[0].id, 'L1')
  })

  it('the second leader can approve before any designer', () => {
    // Leader-first constrains the DESIGNERS only; leaders sign in any order.
    const { project: next } = computeApproval(ozalitProject(), L2, ctx)
    assert.equal(next.ozalit_approvals[0].id, 'L2')
  })

  it('advances only once every leader AND designer has approved', () => {
    const r1 = computeApproval(ozalitProject(), L1, ctx)
    const r2 = computeApproval(r1.project, L2, ctx)
    assert.equal(r2.project.stage, 'ozalit_onay')     // 2/3 — still waiting
    const r3 = computeApproval(r2.project, D1, ctx)
    assert.equal(r3.project.stage, 'uretime_hazir')   // 3/3 → advance
    assert.deepEqual(r3.project.ozalit_approvals, []) // ledger cleared
  })

  it('approving twice is idempotent (no double count)', () => {
    const r1 = computeApproval(ozalitProject(), L1, ctx)
    const r2 = computeApproval(r1.project, L1, ctx)
    assert.equal(r2.project.ozalit_approvals.length, 1)
  })

  it('a non-approver (printer) cannot approve ozalit', () => {
    assert.throws(() => computeApproval(ozalitProject(), printer, ctx), /ekip lideri veya atanmış tasarımcı/)
  })

  it('only a team leader may reject; a designer cannot', () => {
    const rejectCtx = { actorName: D1.name, actor: D1 }
    assert.throws(
      () => computeRejection(ozalitProject(), 'olmaz', [], 'designer', rejectCtx),
      /yalnızca ekip lideri/,
    )
  })

  it('a leader rejection wipes the approval ledger', () => {
    const partial = ozalitProject({ ozalit_approvals: [{ id: 'L1', role: 'team_leader', name: 'Ayşenur' }] })
    const { project: next } = computeRejection(partial, 'renkler', [], 'designer', { actorName: L1.name, actor: L1 })
    assert.deepEqual(next.ozalit_approvals, [])
  })
})

describe('ozalit leader-first approval order', () => {
  const leaderSigned = (extra = {}) =>
    ozalitProject({
      ozalit_approvals: [{ id: 'L1', role: 'team_leader', name: 'Ayşenur', at: '2026-01-01T00:00:00.000Z' }],
      ...extra,
    })

  it('a designer cannot approve before any team leader has', () => {
    assert.throws(() => computeApproval(ozalitProject(), D1, ctx), /Önce ekip lideri onaylamalıdır/)
  })

  it('one leader approval opens the gate for the designer', () => {
    const { project: next } = computeApproval(leaderSigned(), D1, ctx)
    assert.equal(next.ozalit_approvals.length, 2)
    assert.equal(next.ozalit_approvals[1].id, 'D1')
  })

  it('the designer does not need EVERY leader first, just one', () => {
    // L2 still owes an approval — the project can't advance yet, but D1's
    // sign-off is accepted and recorded.
    const { project: next } = computeApproval(leaderSigned(), D1, ctx)
    assert.equal(next.stage, 'ozalit_onay')
    const { project: done } = computeApproval(next, L2, ctx)
    assert.equal(done.stage, 'uretime_hazir')
  })

  it('a leader rejection closes the gate again for the next round', () => {
    // The rejection wipes the ledger, so the re-delivered proof needs a fresh
    // leader sign-off before the designer may approve it.
    const { project: rejected } = computeRejection(
      leaderSigned(), 'renkler', [], 'matbaa', { actorName: L1.name, actor: L1 },
    )
    const redelivered = { ...rejected, stage: 'ozalit_onay', ozalit_received: true }
    assert.throws(() => computeApproval(redelivered, D1, ctx), /Önce ekip lideri onaylamalıdır/)
  })

  it('with no active team leader the designer is not stranded', () => {
    // No leader is in the required set either, so nobody could ever open the
    // gate — enforcing the order there would park the project forever.
    const soloCtx = { teamLeaderIds: [], designerIds: ['D1'] }
    const { project: next } = computeApproval(ozalitProject(), D1, soloCtx)
    assert.equal(next.stage, 'uretime_hazir')
  })

  it('the receipt gate still comes first for the designer', () => {
    const pending = leaderSigned({ ozalit_received: false })
    assert.throws(() => computeApproval(pending, D1, ctx), /Teslim Alındı/)
  })
})

describe('ozalit "Teslim Alındı" gate (migration 035)', () => {
  it('blocks every approver until the proof is acknowledged', () => {
    const pending = ozalitProject({ ozalit_received: false })
    assert.throws(() => computeApproval(pending, L1, ctx), /Teslim Alındı/)
    assert.throws(() => computeApproval(pending, D1, ctx), /Teslim Alındı/)
  })

  it('one acknowledgment opens the gate for the whole multi-party round', () => {
    const { project: received } = computeOzalitReceive(
      ozalitProject({ ozalit_received: false }), D1, { designerIds: ['D1'] },
    )
    assert.equal(received.ozalit_received, true)
    assert.equal(received.ozalit_received_by, 'Abdijibar')
    // The designer acknowledged; a leader who never touched it can now approve.
    const { project: next } = computeApproval(received, L1, ctx)
    assert.equal(next.ozalit_approvals.length, 1)
  })

  it('acknowledging twice is a no-op (no duplicate history row)', () => {
    const { project: first } = computeOzalitReceive(
      ozalitProject({ ozalit_received: false }), L1, { designerIds: [] },
    )
    const { project: second, history } = computeOzalitReceive(first, L1, { designerIds: [] })
    assert.equal(history, null)
    assert.equal(second.ozalit_received_by, 'Ayşenur')
  })

  it('only a leader or an assigned designer may acknowledge', () => {
    assert.throws(
      () => computeOzalitReceive(ozalitProject({ ozalit_received: false }), printer, { designerIds: ['D1'] }),
      /yalnızca ekip lideri veya atanmış tasarımcı/,
    )
  })

  it('refuses outside the ozalit_onay stage', () => {
    assert.throws(
      () => computeOzalitReceive(ozalitProject({ stage: 'ozalit_teslim' }), L1, { designerIds: [] }),
      /yalnızca ozalit onay aşamasında/,
    )
  })

  it('a fresh matbaa delivery clears the previous round\'s acknowledgment', () => {
    // The printer's ozalit_teslim → ozalit_onay advance is the delivery step.
    const delivered = ozalitProject({
      stage: 'ozalit_teslim', ozalit_requested: true,
      ozalit_received: true, ozalit_received_by: 'Ayşenur', ozalit_received_at: '2026-01-01T00:00:00.000Z',
    })
    const { project: next } = computeAdvance(delivered, printer)
    assert.equal(next.stage, 'ozalit_onay')
    assert.equal(next.ozalit_received, false)
    assert.equal(next.ozalit_received_by, null)
    assert.equal(next.ozalit_received_at, null)
  })
})
