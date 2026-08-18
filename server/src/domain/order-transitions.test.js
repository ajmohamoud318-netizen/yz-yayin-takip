/**
 * matbaa_onay multi-party approval — the sipariş mini-workflow's twin of
 * transitions.ozalit.test.js. Every active team leader AND every order
 * assignee must approve before the order advances to onaylandi, leader
 * first, gated on the proof being marked "Teslim Alındı" first.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  computeMatbaaReceive, computeMatbaaNotReceived, computeMatbaaOnayApproval,
} from './order-transitions.js'

const L1 = { id: 'L1', role: 'team_leader', name: 'Ayşenur' }
const L2 = { id: 'L2', role: 'team_leader', name: 'İkinci Lider' }
const D1 = { id: 'D1', role: 'designer', name: 'Abdijibar' }
const printer = { id: 'P1', role: 'printer', name: 'Oktay' }

const ctx = { teamLeaderIds: ['L1', 'L2'], designerIds: ['D1'] }

function matbaaOrder(overrides = {}) {
  return {
    id: 'o-1', status: 'matbaa_onay',
    matbaa_approvals: [], matbaa_received: true,
    ...overrides,
  }
}

describe('multi-party matbaa_onay approval', () => {
  it('a single approval is recorded but does NOT advance', () => {
    const { order: patch, advanced } = computeMatbaaOnayApproval(matbaaOrder(), L1, ctx)
    assert.equal(advanced, false)
    assert.equal(patch.matbaa_approvals.length, 1)
    assert.equal(patch.matbaa_approvals[0].id, 'L1')
  })

  it('the second leader can approve before any designer', () => {
    const { order: patch } = computeMatbaaOnayApproval(matbaaOrder(), L2, ctx)
    assert.equal(patch.matbaa_approvals[0].id, 'L2')
  })

  it('advances only once every leader AND designer has approved', () => {
    const r1 = computeMatbaaOnayApproval(matbaaOrder(), L1, ctx)
    const r2 = computeMatbaaOnayApproval(matbaaOrder({ matbaa_approvals: r1.order.matbaa_approvals }), L2, ctx)
    assert.equal(r2.advanced, false) // 2/3 — still waiting
    const r3 = computeMatbaaOnayApproval(matbaaOrder({ matbaa_approvals: r2.order.matbaa_approvals }), D1, ctx)
    assert.equal(r3.advanced, true) // 3/3 → advance
    assert.deepEqual(r3.order.matbaa_approvals, []) // ledger cleared
  })

  it('approving twice is idempotent (no double count)', () => {
    const r1 = computeMatbaaOnayApproval(matbaaOrder(), L1, ctx)
    const r2 = computeMatbaaOnayApproval(
      matbaaOrder({ matbaa_approvals: r1.order.matbaa_approvals }), L1, ctx,
    )
    assert.equal(r2.order.matbaa_approvals.length, 1)
  })

  it('a non-approver (printer) cannot approve matbaa_onay', () => {
    assert.throws(() => computeMatbaaOnayApproval(matbaaOrder(), printer, ctx), /ekip lideri veya atanmış tasarımcı/)
  })
})

describe('matbaa_onay leader-first approval order', () => {
  const leaderSigned = (extra = {}) =>
    matbaaOrder({
      matbaa_approvals: [{ id: 'L1', role: 'team_leader', name: 'Ayşenur', at: '2026-01-01T00:00:00.000Z' }],
      ...extra,
    })

  it('a designer cannot approve before any team leader has', () => {
    assert.throws(() => computeMatbaaOnayApproval(matbaaOrder(), D1, ctx), /Önce ekip lideri onaylamalıdır/)
  })

  it('one leader approval opens the gate for the designer', () => {
    const { order: patch } = computeMatbaaOnayApproval(leaderSigned(), D1, ctx)
    assert.equal(patch.matbaa_approvals.length, 2)
    assert.equal(patch.matbaa_approvals[1].id, 'D1')
  })

  it('the designer does not need EVERY leader first, just one', () => {
    const r1 = computeMatbaaOnayApproval(leaderSigned(), D1, ctx)
    assert.equal(r1.advanced, false)
    const r2 = computeMatbaaOnayApproval(
      leaderSigned({ matbaa_approvals: r1.order.matbaa_approvals }), L2, ctx,
    )
    assert.equal(r2.advanced, true)
  })

  it('with no active team leader the designer is not stranded', () => {
    const soloCtx = { teamLeaderIds: [], designerIds: ['D1'] }
    const { advanced } = computeMatbaaOnayApproval(matbaaOrder(), D1, soloCtx)
    assert.equal(advanced, true)
  })

  it('the receipt gate still comes first for the designer', () => {
    const pending = leaderSigned({ matbaa_received: false })
    assert.throws(() => computeMatbaaOnayApproval(pending, D1, ctx), /Teslim Alındı/)
  })
})

describe('matbaa_onay "Teslim Alındı" gate', () => {
  it('blocks every approver until the proof is acknowledged', () => {
    const pending = matbaaOrder({ matbaa_received: false })
    assert.throws(() => computeMatbaaOnayApproval(pending, L1, ctx), /Teslim Alındı/)
    assert.throws(() => computeMatbaaOnayApproval(pending, D1, ctx), /Teslim Alındı/)
  })

  it('one acknowledgment opens the gate for the whole multi-party round', () => {
    const { order: received } = computeMatbaaReceive(
      matbaaOrder({ matbaa_received: false }), D1, { designerIds: ['D1'] },
    )
    assert.equal(received.matbaa_received, true)
    assert.equal(received.matbaa_received_by, 'Abdijibar')
    const { advanced } = computeMatbaaOnayApproval(
      matbaaOrder({ ...received }), L1, ctx,
    )
    assert.equal(advanced, false) // recorded, but 1/3 — not yet enough to advance
  })

  it('acknowledging twice is a no-op (no duplicate history row)', () => {
    const { order: first } = computeMatbaaReceive(
      matbaaOrder({ matbaa_received: false }), L1, { designerIds: [] },
    )
    const { history } = computeMatbaaReceive(
      matbaaOrder({ ...first, matbaa_received: true }), L1, { designerIds: [] },
    )
    assert.equal(history, null)
  })

  it('only a leader or an assigned designer may acknowledge', () => {
    assert.throws(
      () => computeMatbaaReceive(matbaaOrder({ matbaa_received: false }), printer, { designerIds: ['D1'] }),
      /yalnızca ekip lideri veya atanmış tasarımcı/,
    )
  })

  it('refuses outside the matbaa_onay stage', () => {
    assert.throws(
      () => computeMatbaaReceive(matbaaOrder({ status: 'tasarimci_onay' }), L1, { designerIds: [] }),
      /yalnızca matbaa onay aşamasında/,
    )
  })
})

describe('matbaa "Teslim Alınamadı"', () => {
  it('sends the order back to tasarimci_onay and wipes the ledger', () => {
    const pending = matbaaOrder({
      matbaa_received: false,
      matbaa_approvals: [{ id: 'L1', role: 'team_leader', name: 'Ayşenur' }],
    })
    const { order: patch } = computeMatbaaNotReceived(pending, L1, { designerIds: [] })
    assert.equal(patch.status, 'tasarimci_onay')
    assert.deepEqual(patch.matbaa_approvals, [])
  })

  it('refuses once the proof has already been acknowledged', () => {
    assert.throws(
      () => computeMatbaaNotReceived(matbaaOrder({ matbaa_received: true }), L1, { designerIds: [] }),
      /zaten teslim alındı/,
    )
  })

  it('only a leader or an assigned designer may report it', () => {
    assert.throws(
      () => computeMatbaaNotReceived(matbaaOrder({ matbaa_received: false }), printer, { designerIds: ['D1'] }),
      /yalnızca ekip lideri veya atanmış tasarımcı/,
    )
  })
})
