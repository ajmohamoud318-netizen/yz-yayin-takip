/**
 * "İptal Et" (cancel) for a mistaken demo/ozalit request — undoes
 * `tasarim → demo_teslim`/`cin_demo_teslim` or the ozalit_teslim request
 * outright, sending the project back to tasarim. Unlike Reddet or "Teslim
 * Alınamadı", this deliberately does NOT bump demo_attempt/ozalit_attempt —
 * nothing was ever delivered, so there's no round to count. Only valid
 * before the matbaa has started (demo_started/ozalit_started false); once
 * started, computeDemoChangeRequest/computeOzalitChangeRequest is the path
 * (see transitions.change-request.test.js).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeDemoCancel, computeOzalitCancel } from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }

function demoProject(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_teslim',
    demo_attempt: 3, demo_started: false, demo_held: false,
    ...overrides,
  }
}

function ozalitProject(overrides = {}) {
  return {
    id: 'p-2', type: 'TR', stage: 'ozalit_teslim',
    ozalit_attempt: 1, ozalit_requested: true, ozalit_started: false,
    ...overrides,
  }
}

describe('demo cancel', () => {
  it('sends the project back to tasarim without bumping demo_attempt', () => {
    const { project: next } = computeDemoCancel(demoProject(), leader, { designerIds: [] })
    assert.equal(next.stage, 'tasarim')
    assert.equal(next.demo_attempt, 3)
  })

  it('works for the ÇİN leg too', () => {
    const { project: next } = computeDemoCancel(
      demoProject({ type: 'CIN', stage: 'cin_demo_teslim' }), leader, { designerIds: [] },
    )
    assert.equal(next.stage, 'tasarim')
  })

  it('clears held/delivered/received/started/change-request ledger fields', () => {
    const { project: next } = computeDemoCancel(
      demoProject({
        demo_held: true, demo_held_at: '2026-01-01T00:00:00Z', demo_held_by_name: 'Aylin',
        demo_delivered_at: '2026-01-01T00:00:00Z', demo_delivered_by: 'u-p',
        demo_received: true, demo_received_by: 'u-l',
        reject_target: 'matbaa',
      }),
      leader, { designerIds: [] },
    )
    assert.equal(next.demo_held, false)
    assert.equal(next.demo_held_at, null)
    assert.equal(next.demo_delivered_at, null)
    assert.equal(next.demo_delivered_by, null)
    assert.equal(next.demo_received, false)
    assert.equal(next.demo_received_by, null)
    assert.equal(next.reject_target, null)
  })

  it('an assigned designer can cancel', () => {
    const designer = { id: 'u-d', role: 'designer', name: 'Aylin' }
    const { project: next } = computeDemoCancel(demoProject(), designer, { designerIds: ['u-d'] })
    assert.equal(next.stage, 'tasarim')
  })

  it('rejects a user who is neither leader nor assigned designer', () => {
    const stranger = { id: 'u-x', role: 'designer', name: 'Biri' }
    assert.throws(
      () => computeDemoCancel(demoProject(), stranger, { designerIds: ['u-d'] }),
      /yalnızca ekip lideri veya atanmış tasarımcı/,
    )
  })

  it('refuses once the matbaa has started', () => {
    assert.throws(
      () => computeDemoCancel(demoProject({ demo_started: true }), leader, { designerIds: [] }),
      /Matbaa demoya başladı/,
    )
  })

  it('refuses outside the demo_teslim / cin_demo_teslim stages', () => {
    assert.throws(
      () => computeDemoCancel(demoProject({ stage: 'demo_onay' }), leader, { designerIds: [] }),
      /yalnızca demo matbaa sürecindeyken/,
    )
  })
})

describe('ozalit cancel', () => {
  it('sends the project back to tasarim without bumping ozalit_attempt', () => {
    const { project: next } = computeOzalitCancel(ozalitProject(), leader, { designerIds: [] })
    assert.equal(next.stage, 'tasarim')
    assert.equal(next.ozalit_attempt, 1)
    assert.equal(next.ozalit_requested, false)
  })

  it('an assigned designer can cancel', () => {
    const designer = { id: 'u-d', role: 'designer', name: 'Aylin' }
    const { project: next } = computeOzalitCancel(ozalitProject(), designer, { designerIds: ['u-d'] })
    assert.equal(next.stage, 'tasarim')
  })

  it('rejects a user who is neither leader nor assigned designer', () => {
    const stranger = { id: 'u-x', role: 'designer', name: 'Biri' }
    assert.throws(
      () => computeOzalitCancel(ozalitProject(), stranger, { designerIds: ['u-d'] }),
      /yalnızca ekip lideri veya atanmış tasarımcı/,
    )
  })

  it('refuses once the matbaa has started', () => {
    assert.throws(
      () => computeOzalitCancel(ozalitProject({ ozalit_started: true }), leader, { designerIds: [] }),
      /Matbaa ozalite başladı/,
    )
  })

  it('refuses the matbaa re-delivery lock case — a rejection already happened there', () => {
    assert.throws(
      () => computeOzalitCancel(
        ozalitProject({ ozalit_requested: false, reject_target: 'matbaa' }), leader, { designerIds: [] },
      ),
      /Bekleyen bir ozalit talebi yok/,
    )
  })

  it('refuses outside the ozalit_teslim stage', () => {
    assert.throws(
      () => computeOzalitCancel(ozalitProject({ stage: 'ozalit_onay' }), leader, { designerIds: [] }),
      /yalnızca ozalit matbaa sürecindeyken/,
    )
  })
})
