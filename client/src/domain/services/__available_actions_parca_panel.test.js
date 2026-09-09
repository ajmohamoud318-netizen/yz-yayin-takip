/**
 * Who owns the approval on a multi-parça round: the header, or the panel?
 *
 * The panel. Reported from live testing: a 3-parça project ran a 2-parça demo
 * round, both parçalar came home, and the header's whole-round "Onaylayın" was
 * sitting above the PARÇA ONAYI panel that had just listed them as two separate
 * pending decisions. One press signed off both and advanced the project — to
 * ozalit, with the third parça never printed once.
 *
 * Two things were wrong and this file pins the first: a button that decides the
 * whole round in one press is not a shortcut for deciding parçalar one at a time,
 * it is a way around it. The panel already carries the honest shortcut —
 * "Tüm parçaları onaylayın", which counts what it is signing and hides itself
 * when it cannot cover the round.
 *
 * REDDET stays. It bounces the whole round for rework, which has no per-parça
 * equivalent that means the same thing, and it is the way out of a round that
 * turned out to be wrong wholesale.
 *
 * The suppression keys on `parcaSnapshot.length >= 2` — the same test
 * ProjectDetail and Approvals use to render the panel at all, so the surface and
 * the suppression can never disagree.
 */

import { describe, it, expect } from 'vitest'

import { availableActions } from './project-detail.js'

const leader = { id: 'u-l', role: 'team_leader' }
const designer = { id: 'u-d', role: 'designer' }

const SPLIT = ['KUTU', 'KİTAP']
const SINGLE = ['KUTU']

function demoOnay(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_onay', origin: null,
    demo_received: true, demo_held: false,
    assignees: [{ id: 'u-d' }],
    ...overrides,
  }
}

function ozalitOnay(overrides = {}) {
  return {
    id: 'p-2', type: 'TR', stage: 'ozalit_onay', origin: null,
    ozalit_received: true, ekran_ozalit: false,
    ozalit_approvals: [],
    ozalit_leader_approved: true,
    assignees: [{ id: 'u-d' }],
    ...overrides,
  }
}

describe('demo_onay — the panel is the approval surface', () => {
  it('withholds the whole-round Onayla on a multi-parça round', () => {
    const actions = availableActions({
      project: demoOnay(), user: leader, parcaSnapshot: SPLIT,
    })
    expect(actions).not.toContain('approve')
  })

  it('keeps Reddet — bouncing the round is still a whole-round act', () => {
    const actions = availableActions({
      project: demoOnay(), user: leader, parcaSnapshot: SPLIT,
    })
    expect(actions).toContain('reject')
  })

  it('keeps Onayla on a single-parça round, where no panel draws', () => {
    const actions = availableActions({
      project: demoOnay(), user: leader, parcaSnapshot: SINGLE,
    })
    expect(actions).toContain('approve')
  })

  it('keeps Onayla on a legacy round with no snapshot at all', () => {
    // Every project from before per-parça rounds. The header pair is the only
    // way to decide anything there, so it has to stay.
    const actions = availableActions({ project: demoOnay(), user: leader })
    expect(actions).toContain('approve')
  })

  it('still hides both before the demo has been received', () => {
    // The receipt gate is unchanged and comes first — you cannot decide a proof
    // nobody has taken delivery of, whatever the snapshot says.
    const actions = availableActions({
      project: demoOnay({ demo_received: false }), user: leader, parcaSnapshot: SPLIT,
    })
    expect(actions).not.toContain('approve')
    expect(actions).not.toContain('reject')
  })
})

describe('ozalit_onay — same rule', () => {
  it('withholds the whole-round Onayla on a multi-parça round', () => {
    const actions = availableActions({
      project: ozalitOnay(), user: leader, parcaSnapshot: SPLIT,
    })
    expect(actions).not.toContain('approve')
    expect(actions).toContain('reject')
  })

  it('withholds the designer’s counter-sign too', () => {
    // Safe: ProjectDetail renders the grid at ozalit_onay for `isLeader ||
    // designer`, which is a superset of who gets this button — so nobody loses
    // their way to sign off, they just do it per parça.
    const actions = availableActions({
      project: ozalitOnay(), user: designer, parcaSnapshot: SPLIT,
    })
    expect(actions).not.toContain('approve')
  })

  it('keeps it on a single-parça round', () => {
    const actions = availableActions({
      project: ozalitOnay(), user: leader, parcaSnapshot: SINGLE,
    })
    expect(actions).toContain('approve')
  })
})

describe('the split-across-desks rule still applies on top', () => {
  it('hides both while a parça is out, snapshot or no snapshot', () => {
    const out = [{ parca: 'KUTU', state: 'approved' }, { parca: 'KİTAP', state: 'with_designer' }]
    const actions = availableActions({
      project: demoOnay(), user: leader, parcaSnapshot: SPLIT, parcaRows: out,
    })
    expect(actions).not.toContain('approve')
    expect(actions).not.toContain('reject')
  })
})
