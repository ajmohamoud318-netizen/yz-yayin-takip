/**
 * The demo/ozalit gate must not close on a parça that was never sent.
 *
 * Every other gate in transitions.js measures a round against its own snapshot,
 * which is right for everything except this one question. A parça left unticked
 * when the round was composed is simply absent from `_selectedComponents`, so it
 * can never appear in `stillPending` — the round reads "fully approved" and the
 * project advances, carrying a parça that never had a demo into ozalit, past the
 * point where "Kalan Parçaları Gönderin" could still send it.
 *
 * Reported from live testing: a 3-parça project, a 2-parça demo round, both
 * delivered and approved, and the project landed on ozalit_teslim with the third
 * parça never printed once.
 *
 * The catalog (Ürün Bilgileri / product_info) is the only thing that knows the
 * project's real parça list, and it arrives as `ctx.catalogParcalar`. It is
 * OPTIONAL — which is why half of these tests are about the guard staying quiet.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeApproval } from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }
const designer = { id: 'u-d', role: 'designer', name: 'Aylin' }

/** The approval ledger row shape `appendParcaApprovals` writes. */
const signed = (parca) => ({ parca, id: leader.id, name: leader.name, at: '2026-09-08T09:00:00.000Z' })

/** A resolved routing row — the record that a parça HAS been sent. */
const routed = (parca, gate) => ({ parca, gate, state: 'pending', attempt: 1 })

function demoOnay(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_onay',
    progress: 100, demo_attempt: 2, demo_held: false, demo_received: true,
    assignees: [{ id: designer.id, name: designer.name }],
    subtasks: [],
    demo_parca_approvals: [],
    parca_state: [],
    ...overrides,
  }
}

const demoCtx = (over = {}) => ({
  snapshot: { selectedComponents: ['KUTU', 'KİTAP'] },
  catalogParcalar: ['KUTU', 'KİTAP', 'KILAVUZ'],
  designerIds: [designer.id],
  ...over,
})

describe('demo gate — a parça the project has but never sent', () => {
  it('refuses the approve that would advance the project', () => {
    // Both round parçalar signed off; the click that would leave demo_onay.
    assert.throws(
      () => computeApproval(
        demoOnay({ demo_parca_approvals: [signed('KUTU'), signed('KİTAP')] }),
        leader,
        demoCtx(),
      ),
      /KILAVUZ/,
    )
  })

  it('names the way out rather than just refusing', () => {
    assert.throws(
      () => computeApproval(
        demoOnay({ demo_parca_approvals: [signed('KUTU'), signed('KİTAP')] }),
        leader,
        demoCtx(),
      ),
      /Kalan Parçaları Gönderin/,
    )
  })

  it('still lets the leader sign off the parçalar that ARE here', () => {
    // The point of the guard is the ADVANCE, not the sign-off. A leader's
    // decision on a delivered parça is real work and blocking it would say
    // nothing useful about the parça that is missing.
    const { project: next } = computeApproval(
      demoOnay(), leader, { ...demoCtx(), parcalar: ['KUTU'] },
    )
    assert.equal(next.stage, 'demo_onay', 'stays put — KİTAP is still pending')
    assert.deepEqual(next.demo_parca_approvals.map((r) => r.parca), ['KUTU'])
  })

  it('advances once the missing parça has been sent and signed off', () => {
    // The round grew to carry KILAVUZ and it went through the matbaa like the
    // others — nothing is owed any more.
    const { project: next } = computeApproval(
      demoOnay({
        demo_parca_approvals: [signed('KUTU'), signed('KİTAP'), signed('KILAVUZ')],
        parca_state: [routed('KUTU', 'demo'), routed('KİTAP', 'demo'), routed('KILAVUZ', 'demo')],
      }),
      leader,
      demoCtx({ snapshot: { selectedComponents: ['KUTU', 'KİTAP', 'KILAVUZ'] } }),
    )
    assert.equal(next.stage, 'ozalit_teslim')
  })

  it('does not count a parça that is merely off the round but has been routed', () => {
    // KILAVUZ is not on this round's sheet, but it has a demo-gate routing row —
    // it was sent, and is out for rework or already decided. That is not the
    // same thing as never sent, and blocking on it would strand the round.
    const { project: next } = computeApproval(
      demoOnay({
        demo_parca_approvals: [signed('KUTU'), signed('KİTAP')],
        parca_state: [routed('KILAVUZ', 'demo')],
      }),
      leader,
      demoCtx(),
    )
    assert.equal(next.stage, 'ozalit_teslim')
  })

})

/** The ozalit leg carries the identical hole, and the identical guard. */
function ozalitOnay(overrides = {}) {
  return {
    id: 'p-2', type: 'TR', stage: 'ozalit_onay',
    progress: 100, ozalit_attempt: 1, ozalit_received: true,
    assignees: [{ id: designer.id, name: designer.name }],
    subtasks: [],
    ozalit_parca_approvals: {},
    ozalit_approvals: [],
    parca_state: [],
    ...overrides,
  }
}

const ozalitCtx = (over = {}) => ({
  snapshot: { selectedComponents: ['KUTU', 'KİTAP'] },
  catalogParcalar: ['KUTU', 'KİTAP', 'KILAVUZ'],
  // One required approver keeps the multi-party arithmetic out of the way —
  // what is under test here is the catalog check, not the counter-signing.
  teamLeaderIds: [leader.id],
  designerIds: [],
  ...over,
})

describe('ozalit gate — the same rule', () => {
  it('refuses the approve that would advance to baskı onayı', () => {
    assert.throws(
      () => computeApproval(ozalitOnay(), leader, ozalitCtx()),
      /KILAVUZ/,
    )
  })

  it('says "ozalite", not "demoya"', () => {
    assert.throws(
      () => computeApproval(ozalitOnay(), leader, ozalitCtx()),
      /ozalite gönderilmemiş/,
    )
  })

  // The cross-gate rule: both legs reuse the same parça NAMES, so a demo-gate
  // row is no evidence at all that the parça ever reached ozalit.
  it('does not accept a demo-gate row as proof the parça reached ozalit', () => {
    assert.throws(
      () => computeApproval(
        ozalitOnay({ parca_state: [routed('KILAVUZ', 'demo')] }),
        leader,
        ozalitCtx(),
      ),
      /KILAVUZ/,
    )
  })

  it('accepts an ozalit-gate row for the same parça', () => {
    const { project: next } = computeApproval(
      ozalitOnay({ parca_state: [routed('KILAVUZ', 'ozalit')] }),
      leader,
      ozalitCtx(),
    )
    assert.equal(next.stage, 'baski_onay')
  })

  it('advances normally when the catalog is absent', () => {
    const { project: next } = computeApproval(
      ozalitOnay(), leader, ozalitCtx({ catalogParcalar: [] }),
    )
    assert.equal(next.stage, 'baski_onay')
  })
})

/**
 * The half that keeps every existing project working. `product_info` is
 * optional — projects that predate it, legacy imports, and anything whose leader
 * has not filled in Ürün Bilgileri simply have no row, and the guard must be
 * invisible to all of them.
 */
describe('demo gate — the guard stays quiet without evidence', () => {
  it('advances normally when the catalog is absent', () => {
    const { project: next } = computeApproval(
      demoOnay({ demo_parca_approvals: [signed('KUTU'), signed('KİTAP')] }),
      leader,
      demoCtx({ catalogParcalar: undefined }),
    )
    assert.equal(next.stage, 'ozalit_teslim')
  })

  it('advances normally when the catalog is empty', () => {
    const { project: next } = computeApproval(
      demoOnay({ demo_parca_approvals: [signed('KUTU'), signed('KİTAP')] }),
      leader,
      demoCtx({ catalogParcalar: [] }),
    )
    assert.equal(next.stage, 'ozalit_teslim')
  })

  it('leaves a whole-sheet round alone even with a fuller catalog', () => {
    // A round with NO parça list is a whole-sheet round: it implicitly covers
    // the project, so there is nothing to measure it against. Judging it here
    // would block every legacy project the moment somebody filled in its
    // Ürün Bilgileri.
    const { project: next } = computeApproval(
      demoOnay(), leader, demoCtx({ snapshot: { selectedComponents: [] } }),
    )
    assert.equal(next.stage, 'ozalit_teslim')
  })

  it('does not fire on the held-demo branch, which never advances', () => {
    // Below 100% the approve records sign-offs and holds. There is no gate
    // being closed, so there is nothing for this guard to protect.
    const { project: next } = computeApproval(
      demoOnay({ progress: 40 }), leader, demoCtx(),
    )
    assert.equal(next.stage, 'demo_onay')
    assert.equal(next.demo_held, true)
  })
})
