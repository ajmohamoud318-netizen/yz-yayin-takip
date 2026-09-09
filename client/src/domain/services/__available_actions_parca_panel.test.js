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
 * The whole-round REDDET moves with it, as "Tümünü Reddedin" in the panel. It is
 * the same act — bouncing the round for rework, which has no per-parça
 * equivalent — but splitting it from the approve, one in the header and one in
 * the panel, left the panel telling half the story. So `availableActions` emits
 * one of two names for it: `reject` when the header is its home, `reject-parca`
 * when the panel is. Every gate (receipt, role, split-across-desks) decides both
 * identically; only the name changes, so a caller rendering neither name simply
 * does not offer the action.
 *
 * The suppression keys on `parcaSnapshot.length >= 2` — the same test
 * ProjectDetail and Approvals use to render the panel at all, so the surface and
 * the suppression can never disagree.
 */

import { describe, it, expect } from 'vitest'

import { availableActions, parcaPanelViewer, parcaPanelDecider } from './project-detail.js'

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

  it('hands the whole-round Reddet to the panel instead of the header', () => {
    const actions = availableActions({
      project: demoOnay(), user: leader, parcaSnapshot: SPLIT,
    })
    expect(actions).not.toContain('reject')
    expect(actions).toContain('reject-parca')
  })

  it('keeps the header pair on a single-parça round, where no panel draws', () => {
    const actions = availableActions({
      project: demoOnay(), user: leader, parcaSnapshot: SINGLE,
    })
    expect(actions).toContain('approve')
    expect(actions).toContain('reject')
    expect(actions).not.toContain('reject-parca')
  })

  it('keeps the header pair on a legacy round with no snapshot at all', () => {
    // Every project from before per-parça rounds. The header is the only way to
    // decide anything there, so it has to stay.
    const actions = availableActions({ project: demoOnay(), user: leader })
    expect(actions).toContain('approve')
    expect(actions).toContain('reject')
  })

  it('still offers nothing before the demo has been received', () => {
    // The receipt gate is unchanged and comes first — you cannot decide a proof
    // nobody has taken delivery of, whatever the snapshot says. Critically it
    // withholds the panel's name too, so relocating the button did not smuggle
    // the action past a gate the header used to enforce.
    const actions = availableActions({
      project: demoOnay({ demo_received: false }), user: leader, parcaSnapshot: SPLIT,
    })
    expect(actions).not.toContain('approve')
    expect(actions).not.toContain('reject')
    expect(actions).not.toContain('reject-parca')
  })
})

describe('ozalit_onay — same rule', () => {
  it('withholds the whole-round Onayla on a multi-parça round', () => {
    const actions = availableActions({
      project: ozalitOnay(), user: leader, parcaSnapshot: SPLIT,
    })
    expect(actions).not.toContain('approve')
    expect(actions).not.toContain('reject')
    expect(actions).toContain('reject-parca')
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
    expect(actions).toContain('reject')
  })

  it('gives the designer no reject at all — that was always leader-only', () => {
    const actions = availableActions({
      project: ozalitOnay(), user: designer, parcaSnapshot: SPLIT,
    })
    expect(actions).not.toContain('reject')
    expect(actions).not.toContain('reject-parca')
  })
})

describe('the split-across-desks rule still applies on top', () => {
  it('offers nothing while a parça is out, in either home', () => {
    // The rule this file must not weaken: a whole-round act while somebody else
    // holds a parça undoes the split. Moving the button into the panel must not
    // give it a way around that, so the panel's name is withheld too.
    const out = [{ parca: 'KUTU', state: 'approved' }, { parca: 'KİTAP', state: 'with_designer' }]
    const actions = availableActions({
      project: demoOnay(), user: leader, parcaSnapshot: SPLIT, parcaRows: out,
    })
    expect(actions).not.toContain('approve')
    expect(actions).not.toContain('reject')
    expect(actions).not.toContain('reject-parca')
  })
})

/**
 * Who the panel draws for — the shared answer that stops the buttons and the
 * surface drifting apart.
 *
 * The page uses it to decide whether to RENDER the panel; the hook uses it to
 * decide whether the header may stop offering the whole-round receipt the panel
 * has taken over. If those two ever disagree, somebody is left with no button at
 * all — and the demo gate is the live example.
 */
describe('parcaPanelViewer — who SEES the panel', () => {
  const printer = { id: 'u-p', role: 'printer' }

  it('draws the demo panel for the leader', () => {
    expect(parcaPanelViewer(leader, 'demo')).toBe(true)
  })

  it('draws it for the ASSIGNED designer, so they can take delivery', () => {
    // The case that splits viewing from deciding. An assigned designer may mark
    // a demo "Teslim Alındı" but may not sign it off, and the receipt now lives
    // in this panel — so they have to see it. Gating on approval rights alone
    // would leave them holding a proof with no way to acknowledge it.
    expect(parcaPanelViewer(designer, 'demo', { isAssigned: true })).toBe(true)
    expect(parcaPanelViewer(designer, 'demo')).toBe(false)
  })

  it('does NOT draw it for the matbaa', () => {
    // The matbaa never approves anything — their part of the round is teslimat,
    // and the parça job board is their surface. (isDemoApprover and the server's
    // canApproveAt still admit them; that is a leftover from when the printer's
    // "Teslim Edin" was modelled as this same advance.)
    expect(parcaPanelViewer(printer, 'demo')).toBe(false)
  })

  it('draws the ozalit panel for both halves of the multi-party sign-off', () => {
    expect(parcaPanelViewer(leader, 'ozalit')).toBe(true)
    expect(parcaPanelViewer(designer, 'ozalit')).toBe(true)
    expect(parcaPanelViewer(printer, 'ozalit')).toBe(false)
  })

  it('is leader-only on the baskı gates', () => {
    expect(parcaPanelViewer(leader, 'baski_onay')).toBe(true)
    expect(parcaPanelViewer(designer, 'baski_onay')).toBe(false)
  })

  it('says no for a missing user', () => {
    expect(parcaPanelViewer(null, 'demo')).toBe(false)
    expect(parcaPanelViewer(undefined, 'ozalit')).toBe(false)
  })
})

describe('parcaPanelDecider — who may act on its rows', () => {
  const printer = { id: 'u-p', role: 'printer' }

  it('is the leader alone at the demo gate', () => {
    expect(parcaPanelDecider(leader, 'demo')).toBe(true)
    expect(parcaPanelDecider(printer, 'demo')).toBe(false)
    expect(parcaPanelDecider(designer, 'demo')).toBe(false)
  })

  it('gives an assigned designer the panel without any thumbs on it', () => {
    // Seeing and deciding come apart here and nowhere else: they get the rows
    // and the receipt, and no sign-off.
    expect(parcaPanelViewer(designer, 'demo', { isAssigned: true })).toBe(true)
    expect(parcaPanelDecider(designer, 'demo')).toBe(false)
  })

  it('matches the viewer on ozalit and baskı, where the two do not diverge', () => {
    for (const kind of ['ozalit', 'baski_onay']) {
      for (const u of [leader, designer, printer]) {
        expect(parcaPanelDecider(u, kind)).toBe(parcaPanelViewer(u, kind))
      }
    }
  })
})

describe('baski_onay — the panel owns it too', () => {
  const baskiOnay = (overrides = {}) => ({
    id: 'p-3', type: 'TR', stage: 'baski_onay', origin: null,
    baski_parca_preparers: {}, baski_parca_approvals: {},
    assignees: [{ id: 'u-d' }],
    ...overrides,
  })

  it('withholds the header button on a multi-parça round', () => {
    // This button is the one place baskı's two steps were folded together —
    // "Baskı Onayı Hazırlayın" before the form exists, "Baskı Onayı Verin"
    // after. The panel splits them, which is the honest shape.
    const actions = availableActions({
      project: baskiOnay(), user: leader, parcaSnapshot: SPLIT,
    })
    expect(actions).not.toContain('approve')
  })

  it('keeps it on a single-parça round', () => {
    const actions = availableActions({
      project: baskiOnay(), user: leader, parcaSnapshot: SINGLE,
    })
    expect(actions).toContain('approve')
  })

  it('keeps it on a legacy round with no snapshot', () => {
    expect(availableActions({ project: baskiOnay(), user: leader })).toContain('approve')
  })

  it('offers nothing to a designer either way — baskı is leader-only', () => {
    for (const snap of [SPLIT, SINGLE]) {
      const actions = availableActions({
        project: baskiOnay(), user: designer, parcaSnapshot: snap,
      })
      expect(actions).not.toContain('approve')
    }
  })

  it('never adds a reject — baskı has no reject leg', () => {
    // You correct the form instead. So unlike demo and ozalit, moving this gate
    // into the panel moves exactly one button.
    const actions = availableActions({
      project: baskiOnay(), user: leader, parcaSnapshot: SPLIT,
    })
    expect(actions).not.toContain('reject')
    expect(actions).not.toContain('reject-parca')
  })
})

/**
 * Until the snapshot has been read, nobody owns the whole-round buttons.
 *
 * The parça list arrives from an async fetch and starts empty, so on the first
 * paint "not asked yet" and "single-parça round" are the same value — and they
 * now imply opposite owners. Guessing draws the header pair for a moment and
 * then withdraws it, which is what a leader sees as the page settling after a
 * refresh: a button that appears exactly long enough to be clicked.
 */
describe('an unread snapshot decides nothing', () => {
  it('offers no whole-round action while the snapshot is still loading', () => {
    const actions = availableActions({
      project: demoOnay(), user: leader, parcaSnapshot: [], parcaSnapshotReady: false,
    })
    expect(actions).not.toContain('approve')
    expect(actions).not.toContain('reject')
    expect(actions).not.toContain('reject-parca')
  })

  it('does the same at the ozalit and baskı gates', () => {
    for (const project of [ozalitOnay(), { ...ozalitOnay(), stage: 'baski_onay' }]) {
      const actions = availableActions({
        project, user: leader, parcaSnapshot: [], parcaSnapshotReady: false,
      })
      expect(actions).not.toContain('approve')
    }
  })

  it('gives the header its pair back once a FAILED read settles', () => {
    // `ready` means settled, not successful. A snapshot that cannot be loaded is
    // a real answer — "no parça list" — and the header pair is the deliberate
    // fallback for it, unchanged.
    const actions = availableActions({
      project: demoOnay(), user: leader, parcaSnapshot: [], parcaSnapshotReady: true,
    })
    expect(actions).toContain('approve')
    expect(actions).toContain('reject')
  })

  it('defaults to ready, so every other caller is unaffected', () => {
    const actions = availableActions({ project: demoOnay(), user: leader })
    expect(actions).toContain('approve')
  })
})

/**
 * The client half of the cancel round-trip (server half:
 * transitions.ozalit-cancel-roundtrip.test.js).
 *
 * Once the completing press has moved the project back to ozalit_teslim, the
 * header has to offer "Ozalit İsteyin" again — otherwise cancelling an ozalit is
 * a one-way door.
 */
describe('after an ozalit cancel, the request is offered again', () => {
  const atOzalitTeslim = {
    id: 'p-1', type: 'TR', stage: 'ozalit_teslim', origin: null,
    ozalit_requested: false, ozalit_started: false, reject_target: null,
    assignees: [{ id: 'u-d' }],
  }

  it('gives the leader the advance that means "Ozalit İsteyin"', () => {
    const actions = availableActions({
      project: atOzalitTeslim, user: leader, parcaSnapshot: SPLIT,
    })
    expect(actions).toContain('advance')
  })

  it('offers it to the assigned designer too', () => {
    const actions = availableActions({
      project: atOzalitTeslim, user: designer, parcaSnapshot: SPLIT,
    })
    expect(actions).toContain('advance')
  })

  it('is not withheld by the parça panel — this is a request, not a decision', () => {
    // The panel took over onay, red and teslim. Asking for the round in the
    // first place was never one of those, and a multi-parça snapshot must not
    // quietly swallow it.
    for (const snap of [SPLIT, SINGLE, []]) {
      expect(availableActions({
        project: atOzalitTeslim, user: leader, parcaSnapshot: snap,
      })).toContain('advance')
    }
  })

  it('withdraws it once the ozalit has actually been requested', () => {
    const actions = availableActions({
      project: { ...atOzalitTeslim, ozalit_requested: true }, user: leader, parcaSnapshot: SPLIT,
    })
    expect(actions).not.toContain('advance')
  })
})
