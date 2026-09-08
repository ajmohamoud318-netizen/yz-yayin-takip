/**
 * The matbaa's whole-sheet "Teslim Edin" while their round is split into
 * parçalar (migration 074) — the printer's half of __available_actions_split.
 *
 * The leader's whole-round pair has been withheld mid-split since that file was
 * written. The printer's has not, and it is the more damaging of the two:
 *
 *   • project-level "İşlemi Başlatın" stamps `demo_started` / `ozalit_started`
 *     on the WHOLE sheet, which is what unlocks the advance below;
 *   • the advance is `computeDemoTeslimAdvance` / `computeOzalitTeslimAdvance`,
 *     and neither has any parça check — the project moves to its onay stage
 *     while parçalar nobody produced are still sitting in the matbaa's queue,
 *     their `parca_state` rows stranded at `with_matbaa`. `deliverParca` is the
 *     only delivery path that gates on `allParcalarDelivered`.
 *
 * Matbaa İşleri always knew this and filtered those projects out of its queue.
 * Onaylar and the project page did not, so the same round offered two different
 * sets of buttons depending on which page the printer happened to be on.
 *
 * `printerParcaJobs` is the parça QUEUE, not `parcaRows`: a first round is split
 * by its snapshot rather than by routing rows, and `deriveTeslimParcalar`
 * derives those on the queue's read path without ever writing them. A project
 * with a two-parça sheet therefore has parça jobs and no parça rows at all,
 * which is exactly the case that was broken.
 */

import { describe, it, expect } from 'vitest'

import { availableActions } from './project-detail.js'

const printer = { id: 'u-p', role: 'printer' }

function demoTeslim(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_teslim', origin: null,
    demo_started: true, demo_change_requested_at: null,
    assignees: [],
    ...overrides,
  }
}

function ozalitTeslim(overrides = {}) {
  return {
    id: 'p-2', type: 'TR', stage: 'ozalit_teslim', origin: null,
    ozalit_requested: true, ozalit_started: true, ozalit_change_requested_at: null,
    assignees: [],
    ...overrides,
  }
}

// What the queue hands back for a two-parça round: one row per parça the
// matbaa still owes. A fresh round is derived, so `parcaRows` stays empty.
const JOBS = [
  { project_id: 'p-1', parca: 'KİTAP', state: 'with_matbaa', gate: 'demo' },
  { project_id: 'p-1', parca: 'KUTU', state: 'in_round', gate: 'demo' },
]

describe('demo_teslim — whole-sheet Teslim Edin vs a split round', () => {
  it('offers the advance when the round is not split', () => {
    const actions = availableActions({ project: demoTeslim(), user: printer })
    expect(actions).toContain('advance')
  })

  it('withholds it while the matbaa still owes parçalar', () => {
    const actions = availableActions({
      project: demoTeslim(), user: printer, printerParcaJobs: JOBS,
    })
    expect(actions).not.toContain('advance')
  })

  it('withholds it on a single leftover parça too', () => {
    // A leader who bounced KUTU alone off an otherwise-signed sheet: one job,
    // still a split round, still the wrong thing to deliver whole.
    const actions = availableActions({
      project: demoTeslim(), user: printer, printerParcaJobs: [JOBS[0]],
    })
    expect(actions).not.toContain('advance')
  })

  it('gives it back once the queue is empty', () => {
    const actions = availableActions({
      project: demoTeslim(), user: printer, printerParcaJobs: [],
    })
    expect(actions).toContain('advance')
  })

  it('is not fooled by parcaRows being empty on a derived first round', () => {
    // The case that shipped broken: a fresh two-parça sheet has jobs in the
    // queue and nothing in parca_state, so the leader's own split check —
    // which reads parcaRows — sees a whole round and says nothing.
    const actions = availableActions({
      project: demoTeslim(), user: printer, parcaRows: [], printerParcaJobs: JOBS,
    })
    expect(actions).not.toContain('advance')
  })
})

describe('ozalit_teslim — same rule', () => {
  it('offers the advance on an unsplit round', () => {
    const actions = availableActions({ project: ozalitTeslim(), user: printer })
    expect(actions).toContain('advance')
  })

  it('withholds it while parçalar are owed', () => {
    const actions = availableActions({
      project: ozalitTeslim(),
      user: printer,
      printerParcaJobs: [{ project_id: 'p-2', parca: 'KUTU', state: 'with_matbaa', gate: 'ozalit' }],
    })
    expect(actions).not.toContain('advance')
  })
})

describe('the gate is the printer’s alone', () => {
  it('leaves the leader’s own actions untouched', () => {
    // Belt and braces on the role check: a leader is never handed parça jobs by
    // the queue, but if they were, their tasarım advance must not vanish.
    const leader = { id: 'u-l', role: 'team_leader' }
    const project = { id: 'p-3', type: 'TR', stage: 'tasarim', origin: null, assignees: [] }
    const actions = availableActions({ project, user: leader, printerParcaJobs: JOBS })
    expect(actions).toContain('advance')
  })
})
