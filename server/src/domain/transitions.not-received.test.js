/**
 * "Teslim Alınamadı" (not received) escape hatches for demo and ozalit.
 *
 *   • Demo: counterpart to computeDemoReceive — before a delivered demo is
 *     acknowledged, the leader or an assigned designer can report it never
 *     arrived, sending it back to the matbaa (bumps demo_attempt, like every
 *     other back-to-teslim transition).
 *   • Ozalit: the same pair, one leg later (migration 035 gave ozalit its own
 *     receipt gate). Reporting non-receipt locks the re-delivery to the matbaa
 *     and wipes the partial approval ledger, since a new physical proof needs
 *     everyone's sign-off again.
 *
 * Both legs keep the matbaa's "Başladım" flag on the way back — unlike a
 * resend or a delivery, the printer already did the work and owes only the
 * re-delivery.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeDemoNotReceived, computeOzalitNotReceived } from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }

function demoProject(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_onay',
    demo_attempt: 5, demo_received: false, demo_held: false,
    ...overrides,
  }
}

function ozalitProject(overrides = {}) {
  return {
    id: 'p-2', type: 'TR', stage: 'ozalit_onay',
    ozalit_attempt: 1, ozalit_approvals: [], reject_target: null,
    ozalit_received: false,
    ...overrides,
  }
}

describe('demo "Teslim Alınamadı" escape hatch', () => {
  it('sends a TR demo back to demo_teslim and bumps demo_attempt', () => {
    const { project: next } = computeDemoNotReceived(demoProject(), leader, { designerIds: [] })
    assert.equal(next.stage, 'demo_teslim')
    assert.equal(next.demo_attempt, 6)
    assert.equal(next.demo_received, false)
  })

  it('sends a ÇİN demo back to cin_demo_teslim', () => {
    const { project: next } = computeDemoNotReceived(
      demoProject({ type: 'CIN', stage: 'cin_demo_onay' }), leader, { designerIds: [] },
    )
    assert.equal(next.stage, 'cin_demo_teslim')
  })

  it('an assigned designer can report non-receipt', () => {
    const designer = { id: 'u-d', role: 'designer', name: 'Aylin' }
    const { project: next } = computeDemoNotReceived(
      demoProject(), designer, { designerIds: ['u-d'] },
    )
    assert.equal(next.stage, 'demo_teslim')
  })

  it('keeps the "Başladım" gate set — the demo exists, the handover failed', () => {
    const { project: next } = computeDemoNotReceived(
      demoProject({ demo_started: true, demo_started_by_name: 'Matbaa' }),
      leader, { designerIds: [] },
    )
    // canMarkDemoStarted goes false / canRequestDemoChange goes true off this:
    // the printer's next action is "Teslim Edin", the leader's "Değişiklik İste".
    assert.equal(next.demo_started, true)
    assert.equal(next.demo_started_by_name, 'Matbaa')
    // A stale change-request ledger still does not carry into the new round.
    assert.equal(next.demo_fix_pending, false)
    assert.equal(next.demo_change_requested_at, null)
  })

  it('rejects a user who is neither leader nor assigned designer', () => {
    const stranger = { id: 'u-x', role: 'designer', name: 'Biri' }
    assert.throws(
      () => computeDemoNotReceived(demoProject(), stranger, { designerIds: ['u-d'] }),
      /yalnızca ekip lideri veya atanmış tasarımcı/,
    )
  })

  it('refuses once the demo is already marked received — nothing to report', () => {
    assert.throws(
      () => computeDemoNotReceived(demoProject({ demo_received: true }), leader, { designerIds: [] }),
      /zaten teslim alındı/,
    )
  })

  it('refuses outside the demo_onay / cin_demo_onay stages', () => {
    assert.throws(
      () => computeDemoNotReceived(demoProject({ stage: 'demo_teslim' }), leader, { designerIds: [] }),
      /yalnızca demo onay aşamasında/,
    )
  })
})

describe('ozalit "Teslim Alınamadı" escape hatch', () => {
  it('sends the project back to ozalit_teslim with the matbaa re-delivery lock', () => {
    const { project: next } = computeOzalitNotReceived(ozalitProject(), leader, { designerIds: [] })
    assert.equal(next.stage, 'ozalit_teslim')
    assert.equal(next.reject_target, 'matbaa')
    assert.equal(next.ozalit_attempt, 2)
    assert.equal(next.ozalit_requested, false)
  })

  it('wipes any partial approval ledger — a new proof needs fresh sign-off', () => {
    const { project: next } = computeOzalitNotReceived(
      ozalitProject({ ozalit_approvals: [{ id: 'u-l', role: 'team_leader', name: 'Ayşenur' }] }),
      leader, { designerIds: [] },
    )
    assert.deepEqual(next.ozalit_approvals, [])
  })

  it('an assigned designer can report non-receipt', () => {
    const designer = { id: 'u-d', role: 'designer', name: 'Aylin' }
    const { project: next } = computeOzalitNotReceived(
      ozalitProject(), designer, { designerIds: ['u-d'] },
    )
    assert.equal(next.stage, 'ozalit_teslim')
  })

  it('keeps the "Başladım" gate set — same reasoning as the demo leg', () => {
    const { project: next } = computeOzalitNotReceived(
      ozalitProject({ ozalit_started: true, ozalit_started_by_name: 'Matbaa' }),
      leader, { designerIds: [] },
    )
    assert.equal(next.ozalit_started, true)
    assert.equal(next.ozalit_started_by_name, 'Matbaa')
    assert.equal(next.ozalit_fix_pending, false)
    assert.equal(next.ozalit_change_requested_at, null)
  })

  it('rejects a user who is neither leader nor assigned designer', () => {
    const stranger = { id: 'u-x', role: 'designer', name: 'Biri' }
    assert.throws(
      () => computeOzalitNotReceived(ozalitProject(), stranger, { designerIds: ['u-d'] }),
      /yalnızca ekip lideri veya atanmış tasarımcı/,
    )
  })

  it('refuses once the ozalit is already marked received — nothing to report', () => {
    assert.throws(
      () => computeOzalitNotReceived(ozalitProject({ ozalit_received: true }), leader, { designerIds: [] }),
      /zaten teslim alındı/,
    )
  })

  it('refuses outside the ozalit_onay stage', () => {
    assert.throws(
      () => computeOzalitNotReceived(ozalitProject({ stage: 'ozalit_teslim' }), leader, { designerIds: [] }),
      /yalnızca ozalit onay aşamasında/,
    )
  })
})
