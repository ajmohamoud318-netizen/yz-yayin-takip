/**
 * Multi-party ozalit approval.
 *
 * Every active team leader AND every assigned designer must approve before the
 * project advances from ozalit_onay → uretime_hazir. Only a team leader may
 * reject; a single rejection sends it back.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeApproval, computeRejection } from './transitions.js'

const L1 = { id: 'L1', role: 'team_leader', name: 'Ayşenur' }
const L2 = { id: 'L2', role: 'team_leader', name: 'İkinci Lider' }
const D1 = { id: 'D1', role: 'designer', name: 'Abdijibar' }
const printer = { id: 'P1', role: 'printer', name: 'Oktay' }

const ctx = { teamLeaderIds: ['L1', 'L2'], designerIds: ['D1'] }

function ozalitProject(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'ozalit_onay', progress: 100,
    ozalit_approvals: [], ozalit_attempt: 0,
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
