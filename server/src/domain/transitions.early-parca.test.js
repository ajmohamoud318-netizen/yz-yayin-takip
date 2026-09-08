/**
 * Early per-parça sign-off (migration 076).
 *
 * Migration 074 let the matbaa deliver a three-parça round one parça at a time,
 * and deliberately kept the project at its *_teslim stage until the last one
 * landed. Nobody taught the leader's side about that: the receipt and the
 * approve/reject gates all key off the *_onay stage, so a KUTU that came back on
 * Monday could not be received, approved or rejected until KİTAP arrived on
 * Thursday. The leader saw a notification and nothing else.
 *
 * The fix moves the decision to where the parça is. A delivered parça the leader
 * has acknowledged (`parca_state.received_at`) is signed off at the teslim
 * stage, into the same ledger the gate reads — so when the round finally lands,
 * the gate finds those parçalar already done and asks only for the rest.
 *
 * Nothing about the round itself changes: the stage does not move, the project's
 * own receipt is untouched, and the last parça's delivery still carries the
 * project to its gate.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeApproval } from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }
const designer = { id: 'u-d', role: 'designer', name: 'Aylin' }
const printer = { id: 'u-m', role: 'printer', name: 'Matbaa' }
const PARCALAR = ['KAPAK', 'KUTU', 'KILAVUZ']

const delivered = (parca, extra = {}) => ({
  parca, gate: 'demo', state: 'pending', owner_role: null, attempt: 1,
  delivered_at: '2026-09-08T09:00:00.000Z', received_at: null, ...extra,
})
const received = (parca, extra = {}) =>
  delivered(parca, { received_at: '2026-09-08T10:00:00.000Z', ...extra })
const withMatbaa = (parca) => ({
  parca, gate: 'demo', state: 'with_matbaa', owner_role: 'printer', attempt: 1,
  delivered_at: null, received_at: null,
})

/** A demo round still out at the matbaa: KUTU is back and receipted, the rest aren't. */
function midRound(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_teslim', progress: 100,
    demo_attempt: 1, demo_received: false,
    demo_parca_approvals: [], demo_parca_rejections: [],
    assignees: [{ id: 'u-d', name: 'Aylin' }],
    subtasks: [{ id: 's1', kind: 'check', is_done: true }],
    parca_state: [received('KUTU'), withMatbaa('KAPAK'), withMatbaa('KILAVUZ')],
    ...overrides,
  }
}

const ctx = (extra = {}) => ({
  actorName: leader.name,
  snapshot: { selectedComponents: PARCALAR },
  ...extra,
})

describe('approving a parça before its round is finished', () => {
  it('signs off a received parça and leaves the project where it is', () => {
    const { project: next, history } = computeApproval(midRound(), leader, ctx({ parcalar: ['KUTU'] }))
    assert.equal(next.stage, 'demo_teslim', 'the round is still out — the project must not move')
    assert.deepEqual(next.demo_parca_approvals.map((a) => a.parca), ['KUTU'])
    assert.equal(next.demo_parca_approvals[0].by, 'u-l')
    assert.equal(history.from_stage, history.to_stage)
    assert.match(history.note, /KUTU/)
  })

  it('leaves the project-level receipt alone — that belongs to the whole round', () => {
    const { project: next } = computeApproval(midRound(), leader, ctx({ parcalar: ['KUTU'] }))
    assert.equal(next.demo_received, false)
    assert.equal(next.demo_attempt, 1)
  })

  it('refuses a parça that was delivered but never taken delivery of', () => {
    const p = midRound({ parca_state: [delivered('KUTU'), withMatbaa('KAPAK')] })
    assert.throws(
      () => computeApproval(p, leader, ctx({ parcalar: ['KUTU'] })),
      (err) => err.status === 400 && /KUTU teslim alınmadı/.test(err.message),
    )
  })

  it('refuses a parça that is still on the matbaa\'s desk', () => {
    assert.throws(
      () => computeApproval(midRound(), leader, ctx({ parcalar: ['KAPAK'] })),
      (err) => err.status === 400 && /KAPAK/.test(err.message),
    )
  })

  it('bulk signs off only what has actually arrived', () => {
    const p = midRound({
      parca_state: [received('KUTU'), received('KAPAK'), withMatbaa('KILAVUZ')],
    })
    const { project: next } = computeApproval(p, leader, ctx())
    assert.deepEqual(next.demo_parca_approvals.map((a) => a.parca).sort(), ['KAPAK', 'KUTU'])
    assert.equal(next.stage, 'demo_teslim')
  })

  it('refuses when nothing has been received yet, with a reason', () => {
    const p = midRound({ parca_state: [delivered('KUTU'), withMatbaa('KAPAK')] })
    assert.throws(
      () => computeApproval(p, leader, ctx()),
      (err) => err.status === 400 && /teslim alınmış parça yok/.test(err.message),
    )
  })

  it('will not sign the same parça twice for the same leader', () => {
    const once = computeApproval(midRound(), leader, ctx({ parcalar: ['KUTU'] })).project
    assert.throws(
      () => computeApproval({ ...midRound(), demo_parca_approvals: once.demo_parca_approvals },
        leader, ctx({ parcalar: ['KUTU'] })),
      (err) => err.status === 400 && /zaten onayladınız/.test(err.message),
    )
  })

  it('is the leader\'s call alone — the matbaa is still producing this round', () => {
    for (const actor of [printer, designer]) {
      assert.throws(
        () => computeApproval(midRound(), actor, ctx({ parcalar: ['KUTU'] })),
        (err) => err.status === 400 && /ekip lideri/.test(err.message),
      )
    }
  })

  it('writes an ozalit round into the ozalit ledger', () => {
    const p = midRound({
      stage: 'ozalit_teslim',
      ozalit_parca_approvals: {}, ozalit_parca_rejections: [],
      parca_state: [received('KUTU', { gate: 'ozalit' })],
    })
    const { project: next } = computeApproval(p, leader, ctx({ parcalar: ['KUTU'] }))
    assert.equal(next.stage, 'ozalit_teslim')
    assert.deepEqual(Object.keys(next.ozalit_parca_approvals), ['KUTU'])
    assert.equal(next.ozalit_parca_approvals.KUTU[0].id, 'u-l')
    assert.deepEqual(next.demo_parca_approvals, [], 'the demo ledger is not this round\'s')
  })
})

describe('the early signature is the same signature the gate reads', () => {
  it('the gate asks only for what is genuinely still undecided', () => {
    // KUTU was signed off early, at demo_teslim. The last parça has since been
    // delivered, so the project sits at demo_onay with the round received. One
    // click on the rest must now complete the round — if the early signature
    // had been lost, this would hold at demo_onay asking for KUTU again.
    const early = computeApproval(
      midRound({ parca_state: [received('KUTU'), withMatbaa('KAPAK'), withMatbaa('KILAVUZ')] }),
      leader, ctx({ parcalar: ['KUTU'] }),
    ).project
    const atGate = {
      ...early,
      stage: 'demo_onay',
      demo_received: true,
      parca_state: [received('KUTU'), received('KAPAK'), received('KILAVUZ')],
    }
    const { project: next } = computeApproval(atGate, leader, ctx())
    assert.equal(next.stage, 'ozalit_teslim', 'the round completes on the remaining parçalar')
    assert.deepEqual(next.demo_parca_approvals.map((a) => a.parca).sort(), PARCALAR.slice().sort())
  })
})
