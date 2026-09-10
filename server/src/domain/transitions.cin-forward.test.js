/**
 * ÇİN's teslim leg: the team leader forwards the demo that came back from China.
 *
 * Every ÇİN screen assumed this — the leader's button at cin_demo_teslim, the
 * "Lider incelemesinde" badge, matbaa queues that list TR projects only — while
 * the server let only the printer deliver there. No ÇİN project could leave
 * Çin Demo Teslim from the app.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeAdvance } from './transitions.js'

const leader = { id: 'L1', role: 'team_leader', name: 'Ayşenur' }
const designer = { id: 'D1', role: 'designer', name: 'Aylin' }
const printer = { id: 'P1', role: 'printer', name: 'Oktay' }

function cinTeslim(overrides = {}) {
  return {
    id: 'p-cin',
    type: 'CIN',
    stage: 'cin_demo_teslim',
    progress: 40,
    demo_attempt: 1,
    demo_held: false,
    assignees: [{ id: 'D1', name: 'Aylin' }],
    ...overrides,
  }
}

describe('ÇİN demo forward', () => {
  it('the team leader sends the demo on to its approval gate', () => {
    const { project, history } = computeAdvance(cinTeslim(), leader)
    assert.equal(project.stage, 'cin_demo_onay')
    assert.equal(project.demo_delivered_by, 'L1')
    assert.equal(project.demo_received, false, 'the gate still owes its Teslim Alındı, as on TR')
    assert.equal(project.demo_attempt, 1, 'a forward is the same round, not a new one')
    assert.equal(history.to_stage, 'cin_demo_onay')
  })

  it('an assigned designer still cannot', () => {
    assert.throws(() => computeAdvance(cinTeslim(), designer), /Devam eden bir demo var/)
  })

  it('does not hand the TR matbaa delivery to the leader', () => {
    assert.throws(
      () => computeAdvance(cinTeslim({ type: 'TR', stage: 'demo_teslim' }), leader),
      /Devam eden bir demo var/,
    )
  })

  it('forwards a multi-parça round nobody routed to the matbaa', () => {
    const project = cinTeslim({ round_parcalar: ['KİTAP', 'KUTU'], parca_state: [] })
    assert.equal(computeAdvance(project, leader).project.stage, 'cin_demo_onay')
  })

  it('refuses while the matbaa is holding a parça of the round', () => {
    const project = cinTeslim({
      round_parcalar: ['KİTAP', 'KUTU'],
      parca_state: [{ parca: 'KUTU', gate: 'demo', state: 'in_round' }],
    })
    assert.throws(() => computeAdvance(project, leader), /Matbaada devam eden parçalar var: KUTU/)
  })

  it('leaves the printer path exactly as it was', () => {
    assert.equal(computeAdvance(cinTeslim(), printer).project.stage, 'cin_demo_onay')
  })
})
