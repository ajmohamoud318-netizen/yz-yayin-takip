/**
 * Ekran Demo Onayı (migration 050): the lightweight digital alternative to
 * a full physical re-demo for a HELD demo (approved at <100%, see
 * computeApproval's demo_onay branch) once progress reaches 100%. Mirrors
 * the sipariş pipeline's `ekran_onay` (migration 046) — single team-leader
 * click, no matbaa involvement, no multi-party ledger.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  computeEkranDemoRequest,
  computeEkranDemoApprove,
  computeEkranDemoReject,
} from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }
const designer = { id: 'u-d', role: 'designer', name: 'Aylin' }
const stranger = { id: 'u-x', role: 'designer', name: 'Biri' }
const printer = { id: 'u-p', role: 'printer', name: 'Oktay' }

function heldDemoProject(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_onay', progress: 100,
    demo_held: true, demo_attempt: 1,
    assignees: [{ id: 'u-d' }],
    ...overrides,
  }
}

describe('computeEkranDemoRequest', () => {
  it('assigned designer can request it on a held demo at 100%', () => {
    const { project: next, history } = computeEkranDemoRequest(heldDemoProject(), designer)
    assert.equal(next.ekran_demo_requested_by, 'u-d')
    assert.ok(next.ekran_demo_requested_at)
    assert.equal(next.stage, 'demo_onay')
    assert.equal(history.event, 'ekran_demo_requested')
  })

  // Requesting and deciding must stay in different hands: the leader is the
  // one who answers this request, so they may not raise it.
  it('refuses the team leader — they respond, they do not request', () => {
    assert.throws(
      () => computeEkranDemoRequest(heldDemoProject(), leader),
      /yalnızca atanmış tasarımcı/,
    )
  })

  it('refuses a non-assigned designer', () => {
    assert.throws(
      () => computeEkranDemoRequest(heldDemoProject(), stranger),
      /yalnızca atanmış tasarımcı/,
    )
  })

  it('refuses the matbaa', () => {
    assert.throws(
      () => computeEkranDemoRequest(heldDemoProject(), printer),
      /yalnızca atanmış tasarımcı/,
    )
  })

  // `assignees` is a membership list, so an id match alone is not enough —
  // the actor has to actually be a designer.
  it('refuses a non-designer who happens to be in assignees', () => {
    assert.throws(
      () => computeEkranDemoRequest(
        heldDemoProject({ assignees: [{ id: 'u-p' }] }), printer,
      ),
      /yalnızca atanmış tasarımcı/,
    )
  })

  it('refuses when the demo is not held', () => {
    assert.throws(
      () => computeEkranDemoRequest(heldDemoProject({ demo_held: false }), designer),
      /yalnızca askıda kalan bir demo için/,
    )
  })

  it('refuses below 100% progress', () => {
    assert.throws(
      () => computeEkranDemoRequest(heldDemoProject({ progress: 80 }), designer),
      /tasarım %100 tamamlandığında/,
    )
  })

  it('refuses outside demo_onay/cin_demo_onay', () => {
    assert.throws(
      () => computeEkranDemoRequest(heldDemoProject({ stage: 'demo_teslim' }), designer),
      /yalnızca demo onay aşamasında/,
    )
  })

  it('refuses stacking a second pending request', () => {
    assert.throws(
      () => computeEkranDemoRequest(
        heldDemoProject({ ekran_demo_requested_at: '2026-01-01T00:00:00Z' }), designer,
      ),
      /Zaten bekleyen bir ekran demo onayı talebi var/,
    )
  })

  it('works for the ÇİN mirror stage', () => {
    const { project: next } = computeEkranDemoRequest(
      heldDemoProject({ type: 'CIN', stage: 'cin_demo_onay' }), designer,
    )
    assert.ok(next.ekran_demo_requested_at)
  })
})

describe('computeEkranDemoApprove', () => {
  function pending(overrides = {}) {
    return heldDemoProject({
      ekran_demo_requested_at: '2026-01-01T00:00:00Z',
      ekran_demo_requested_by: 'u-l',
      ekran_demo_requested_by_name: 'Ayşenur',
      ...overrides,
    })
  }

  it('advances TR to ozalit_teslim exactly like a normal ≥100% demo approval', () => {
    const { project: next, history } = computeEkranDemoApprove(pending(), leader)
    assert.equal(next.stage, 'ozalit_teslim')
    assert.equal(next.demo_held, false)
    assert.equal(next.ekran_demo_requested_at, null)
    assert.equal(history.action, 'approve')
    assert.equal(history.to_stage, 'ozalit_teslim')
  })

  it('advances CIN straight to cin_baski_onay (no ozalit leg)', () => {
    const { project: next } = computeEkranDemoApprove(
      pending({ type: 'CIN', stage: 'cin_demo_onay' }), leader,
    )
    assert.equal(next.stage, 'cin_baski_onay')
  })

  it('is team-leader-only', () => {
    assert.throws(() => computeEkranDemoApprove(pending(), designer), /yalnızca ekip lideri/)
    assert.throws(() => computeEkranDemoApprove(pending(), printer), /yalnızca ekip lideri/)
  })

  it('refuses without a pending request', () => {
    assert.throws(
      () => computeEkranDemoApprove(heldDemoProject(), leader),
      /Bekleyen bir ekran demo onayı talebi yok/,
    )
  })

  it('is blocked below 100% progress even with a pending request (safety net)', () => {
    assert.throws(
      () => computeEkranDemoApprove(pending({ progress: 90 }), leader),
      /%100 tamamlanmadan/,
    )
  })
})

describe('computeEkranDemoReject', () => {
  function pending(overrides = {}) {
    return heldDemoProject({
      ekran_demo_requested_at: '2026-01-01T00:00:00Z',
      ekran_demo_requested_by: 'u-l',
      demo_attempt: 3,
      ...overrides,
    })
  }

  it('clears the pending request, leaving stage/demo_held/demo_attempt untouched', () => {
    const { project: next, history } = computeEkranDemoReject(pending(), leader, { reason: 'Yazı tipi yanlış' })
    assert.equal(next.ekran_demo_requested_at, null)
    assert.equal(next.stage, 'demo_onay')
    assert.equal(next.demo_held, true)
    assert.equal(next.demo_attempt, 3)
    assert.equal(history.action, 'reject')
    assert.equal(history.reason, 'Yazı tipi yanlış')
  })

  it('requires a reason', () => {
    assert.throws(() => computeEkranDemoReject(pending(), leader, {}), /Red sebebi zorunludur/)
    assert.throws(() => computeEkranDemoReject(pending(), leader, { reason: '   ' }), /Red sebebi zorunludur/)
  })

  it('is team-leader-only', () => {
    assert.throws(
      () => computeEkranDemoReject(pending(), designer, { reason: 'x' }),
      /yalnızca ekip lideri/,
    )
  })

  it('refuses without a pending request', () => {
    assert.throws(
      () => computeEkranDemoReject(heldDemoProject(), leader, { reason: 'x' }),
      /Bekleyen bir ekran demo onayı talebi yok/,
    )
  })
})
