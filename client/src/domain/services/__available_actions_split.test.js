/**
 * Whole-round actions while a round is split across desks (migration 074).
 *
 * The bug this pins, reported from production: a leader rejected one parça to
 * the designer, the designer sent it to the matbaa, the matbaa delivered — and
 * the project-level "Onayla" / "Reddet" pair sat there live the whole time.
 *
 * Both are whole-ROUND operations and neither is safe mid-split:
 *
 *   • project-level Onayla signs off every parça still pending on the
 *     snapshot — including the one sitting on somebody else's desk, which
 *     nobody has looked at;
 *   • project-level Reddet wipes the per-parça ledger and bounces the whole
 *     sheet, discarding the sign-offs the leader already gave.
 *
 * Either one silently undoes the split. While a parça is out, the parça grid
 * is the only surface; the whole-round pair returns once every parça is home.
 *
 * Note these cases deliberately pass NO `parcaSnapshot`, so they isolate this one
 * rule. A round that does carry a multi-parça snapshot no longer gets the
 * whole-round Onayla back even with every parça home — the panel owns approval
 * there, and __available_actions_parca_panel.test.js pins that separately.
 * Reddet, which these tests also cover, is unaffected by it.
 */

import { describe, it, expect } from 'vitest'

import { availableActions } from './project-detail.js'

const leader = { id: 'u-l', role: 'team_leader' }
const designer = { id: 'u-d', role: 'designer' }

function ozalitOnay(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'ozalit_onay', origin: null,
    ozalit_received: true, ekran_ozalit: false,
    ozalit_approvals: [],
    ozalit_leader_approved: true,
    assignees: [{ id: 'u-d' }],
    ...overrides,
  }
}

function demoOnay(overrides = {}) {
  return {
    id: 'p-2', type: 'TR', stage: 'demo_onay', origin: null,
    demo_received: true, demo_held: false,
    assignees: [{ id: 'u-d' }],
    ...overrides,
  }
}

const OUT = [
  { parca: 'KUTU', state: 'approved' },
  { parca: 'KİTAP', state: 'with_designer' },
]
const HOME = [
  { parca: 'KUTU', state: 'approved' },
  { parca: 'KİTAP', state: 'pending' },
]

describe('ozalit_onay — whole-round pair vs a split round', () => {
  it('offers Onayla and Reddet when nothing is out', () => {
    const actions = availableActions({ project: ozalitOnay(), user: leader, parcaRows: HOME })
    expect(actions).toContain('approve')
    expect(actions).toContain('reject')
  })

  it('withholds both while a parça is with the designer', () => {
    const actions = availableActions({ project: ozalitOnay(), user: leader, parcaRows: OUT })
    expect(actions).not.toContain('approve')
    expect(actions).not.toContain('reject')
  })

  it('withholds both while a parça is at the matbaa, started or not', () => {
    for (const state of ['with_matbaa', 'in_round']) {
      const rows = [{ parca: 'KUTU', state: 'approved' }, { parca: 'KİTAP', state }]
      const actions = availableActions({ project: ozalitOnay(), user: leader, parcaRows: rows })
      expect(actions).not.toContain('approve')
      expect(actions).not.toContain('reject')
    }
  })

  it('withholds the designer’s Onayla too — it is the same whole-round call', () => {
    const actions = availableActions({ project: ozalitOnay(), user: designer, parcaRows: OUT })
    expect(actions).not.toContain('approve')
  })

  it('gives the pair back once every parça is home', () => {
    const actions = availableActions({ project: ozalitOnay(), user: leader, parcaRows: HOME })
    expect(actions).toContain('approve')
  })
})

describe('demo_onay — same rule', () => {
  it('offers the pair when nothing is out', () => {
    const actions = availableActions({ project: demoOnay(), user: leader, parcaRows: HOME })
    expect(actions).toContain('approve')
    expect(actions).toContain('reject')
  })

  it('withholds both while a parça is out', () => {
    const actions = availableActions({ project: demoOnay(), user: leader, parcaRows: OUT })
    expect(actions).not.toContain('approve')
    expect(actions).not.toContain('reject')
  })
})

describe('projects with no per-parça routing are unaffected', () => {
  it('behaves exactly as before when there are no parça rows at all', () => {
    // Every project that predates migration 074, and every single-parça round.
    const actions = availableActions({ project: ozalitOnay(), user: leader })
    expect(actions).toContain('approve')
    expect(actions).toContain('reject')
  })

  it('treats an empty array the same as absent', () => {
    const actions = availableActions({ project: ozalitOnay(), user: leader, parcaRows: [] })
    expect(actions).toContain('approve')
  })
})
