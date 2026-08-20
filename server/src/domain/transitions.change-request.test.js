/**
 * Change-request flow: once the matbaa has marked "Başladım" (started), a
 * cancel/edit is no longer free — the leader/assigned designer asks, and
 * the printer accepts (un-starts the round, reopening free cancel/edit) or
 * declines (round stays started, leader/designer waits for normal delivery
 * + the existing Reddet flow). Also covers the reset-on-fresh-round ripple
 * into computeDemoTeslimAdvance / computeOzalitTeslimAdvance /
 * computeDemoNotReceived / computeOzalitNotReceived and the held-resend
 * branch of computeAdvance.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  computeAdvance,
  computeDemoStart, computeOzalitStart,
  computeDemoChangeRequest, computeOzalitChangeRequest,
  computeDemoChangeAccept, computeDemoChangeDecline,
  computeOzalitChangeAccept, computeOzalitChangeDecline,
  computeDemoNotReceived, computeOzalitNotReceived,
} from './transitions.js'

const printer = { id: 'u-p', role: 'printer', name: 'Oktay' }
const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }
const designer = { id: 'u-d', role: 'designer', name: 'Aylin' }

function demoProject(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_teslim',
    demo_attempt: 1, demo_started: false, demo_held: false,
    ...overrides,
  }
}

function ozalitProject(overrides = {}) {
  return {
    id: 'p-2', type: 'TR', stage: 'ozalit_teslim', progress: 100,
    ozalit_attempt: 1, ozalit_requested: true, ozalit_started: false,
    ...overrides,
  }
}

describe('demo "Başladım"', () => {
  it('printer marks the demo started, no stage change', () => {
    const { project: next } = computeDemoStart(demoProject(), printer)
    assert.equal(next.demo_started, true)
    assert.equal(next.demo_started_by, 'u-p')
    assert.equal(next.stage, 'demo_teslim')
  })

  it('is idempotent on a repeat click', () => {
    const { history } = computeDemoStart(demoProject({ demo_started: true }), printer)
    assert.equal(history, null)
  })

  it('rejects a non-printer', () => {
    assert.throws(() => computeDemoStart(demoProject(), leader), /yalnızca matbaa/)
  })

  it('refuses outside the demo_teslim / cin_demo_teslim stages', () => {
    assert.throws(
      () => computeDemoStart(demoProject({ stage: 'demo_onay' }), printer),
      /yalnızca demo matbaa aşamasında/,
    )
  })
})

describe('ozalit "Başladım"', () => {
  it('printer marks the ozalit started, no stage change', () => {
    const { project: next } = computeOzalitStart(ozalitProject(), printer)
    assert.equal(next.ozalit_started, true)
    assert.equal(next.stage, 'ozalit_teslim')
  })

  it('is idempotent on a repeat click', () => {
    const { history } = computeOzalitStart(ozalitProject({ ozalit_started: true }), printer)
    assert.equal(history, null)
  })
})

describe('demo change-request', () => {
  it('requires the matbaa to have started', () => {
    assert.throws(
      () => computeDemoChangeRequest(demoProject(), leader, { note: 'renk yanlış' }, { designerIds: [] }),
      /Matbaa henüz başlamadı/,
    )
  })

  it('leader can request a change once started', () => {
    const { project: next } = computeDemoChangeRequest(
      demoProject({ demo_started: true }), leader, { note: 'renk yanlış' }, { designerIds: [] },
    )
    assert.equal(next.demo_change_requested_by, 'u-l')
    assert.equal(next.demo_change_requested_note, 'renk yanlış')
  })

  it('refuses stacking a second pending request', () => {
    assert.throws(
      () => computeDemoChangeRequest(
        demoProject({ demo_started: true, demo_change_requested_at: '2026-01-01T00:00:00Z' }),
        leader, {}, { designerIds: [] },
      ),
      /Zaten bekleyen bir değişiklik talebi var/,
    )
  })

  it('rejects a user who is neither leader nor assigned designer', () => {
    const stranger = { id: 'u-x', role: 'designer', name: 'Biri' }
    assert.throws(
      () => computeDemoChangeRequest(demoProject({ demo_started: true }), stranger, {}, { designerIds: ['u-d'] }),
      /yalnızca ekip lideri veya atanmış tasarımcı/,
    )
  })
})

describe('demo change accept/decline', () => {
  it('accept un-starts the round and clears the request', () => {
    const { project: next } = computeDemoChangeAccept(
      demoProject({ demo_started: true, demo_change_requested_at: '2026-01-01T00:00:00Z', demo_change_requested_by: 'u-l' }),
      printer,
    )
    assert.equal(next.demo_started, false)
    assert.equal(next.demo_change_requested_at, null)
  })

  it('decline clears the request but leaves demo_started true', () => {
    const { project: next } = computeDemoChangeDecline(
      demoProject({ demo_started: true, demo_change_requested_at: '2026-01-01T00:00:00Z' }),
      printer,
    )
    assert.equal(next.demo_started, true)
    assert.equal(next.demo_change_requested_at, null)
  })

  it('both are printer-only', () => {
    const started = demoProject({ demo_started: true, demo_change_requested_at: '2026-01-01T00:00:00Z' })
    assert.throws(() => computeDemoChangeAccept(started, leader), /yalnızca matbaa/)
    assert.throws(() => computeDemoChangeDecline(started, leader), /yalnızca matbaa/)
  })

  it('both refuse when there is no pending request', () => {
    assert.throws(() => computeDemoChangeAccept(demoProject({ demo_started: true }), printer), /Bekleyen bir değişiklik talebi yok/)
    assert.throws(() => computeDemoChangeDecline(demoProject({ demo_started: true }), printer), /Bekleyen bir değişiklik talebi yok/)
  })
})

describe('ozalit change-request / accept / decline mirror the demo leg', () => {
  it('requires the matbaa to have started', () => {
    assert.throws(
      () => computeOzalitChangeRequest(ozalitProject(), leader, {}, { designerIds: [] }),
      /Matbaa henüz başlamadı/,
    )
  })

  it('accept un-starts, decline leaves started true', () => {
    const requested = ozalitProject({ ozalit_started: true, ozalit_change_requested_at: '2026-01-01T00:00:00Z' })
    assert.equal(computeOzalitChangeAccept(requested, printer).project.ozalit_started, false)
    assert.equal(computeOzalitChangeDecline(requested, printer).project.ozalit_started, true)
  })
})

describe('a fresh printer round resets the started/change-request ledger', () => {
  it('computeAdvance delivering a demo resets demo_started', () => {
    const { project: next } = computeAdvance(
      demoProject({ demo_started: true, demo_change_requested_at: null }), printer,
    )
    assert.equal(next.demo_started, false)
    assert.equal(next.stage, 'demo_onay')
  })

  it('computeAdvance refuses to deliver a demo past a pending change-request', () => {
    assert.throws(
      () => computeAdvance(
        demoProject({ demo_started: true, demo_change_requested_at: '2026-01-01T00:00:00Z' }), printer,
      ),
      /Bekleyen bir değişiklik talebi var/,
    )
  })

  it('computeAdvance delivering ozalit resets ozalit_started', () => {
    const { project: next } = computeAdvance(
      ozalitProject({ ozalit_started: true, ozalit_change_requested_at: null }), printer,
    )
    assert.equal(next.ozalit_started, false)
    assert.equal(next.stage, 'ozalit_onay')
  })

  it('the held-resend branch resets demo_started', () => {
    const { project: next } = computeAdvance(
      demoProject({
        stage: 'demo_onay', demo_held: true, demo_started: true, demo_attempt: 2,
      }),
      leader,
    )
    assert.equal(next.demo_started, false)
    assert.equal(next.stage, 'demo_teslim')
  })

  it('computeDemoNotReceived resets demo_started', () => {
    const { project: next } = computeDemoNotReceived(
      { id: 'p-3', type: 'TR', stage: 'demo_onay', demo_attempt: 1, demo_received: false, demo_started: true },
      leader, { designerIds: [] },
    )
    assert.equal(next.demo_started, false)
  })

  it('computeOzalitNotReceived resets ozalit_started', () => {
    const { project: next } = computeOzalitNotReceived(
      { id: 'p-4', type: 'TR', stage: 'ozalit_onay', ozalit_attempt: 1, ozalit_received: false, ozalit_started: true },
      leader, { designerIds: [] },
    )
    assert.equal(next.ozalit_started, false)
  })
})
