/**
 * Sending a parça the round forgot, after the round has already come home.
 *
 * "Kalan Parçaları Gönderin" used to live only at the *_teslim stages, because
 * it works by adding parçalar to the sheet the matbaa is holding. That window
 * closes the moment the last delivery carries the project to *_onay — which is
 * exactly where the leader tends to NOTICE a parça is missing, and by then the
 * only way to send it was to reject a demo that was perfectly good.
 *
 * So the add is allowed at the onay gate too, and there it reopens the round:
 * the project goes back to *_teslim with the new parça on the sheet.
 *
 * The rule that makes this safe is what most of this file pins — the round GREW,
 * it did not start over. Unlike the resend leg in computeAdvance (which wipes the
 * per-parça ledgers and the routing table on purpose, because a fresh physical
 * demo needs fresh eyes), this must leave both alone: the parçalar already
 * produced were genuinely produced, and the sign-offs already given were
 * genuinely given. Losing either would make the matbaa reprint work nobody asked
 * for and the leader re-approve work they had already done.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeDemoEdit, computeOzalitEdit } from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }

/** A resolved routing row — a parça that went out and came back. */
const routed = (parca, gate) => ({
  parca, gate, state: 'pending', owner_role: 'printer', attempt: 1,
  delivered_at: '2026-09-08T09:00:00.000Z', received_at: null,
})

const signed = (parca) => ({ parca, id: leader.id, name: leader.name, at: '2026-09-08T10:00:00.000Z' })

/** The ctx shape withDemoSnapshot builds for a "Kalan Parçaları Gönderin" save. */
const addCtx = (added = ['KILAVUZ']) => ({
  allowParcaAdd: true,
  parcaSetDelta: { added, removed: [] },
  changedParcalar: added,
  demoId: 'snap-9',
})

function demoOnay(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_onay',
    progress: 100, demo_attempt: 2, demo_held: false,
    demo_received: true, demo_received_by: 'Ayşenur', demo_received_at: '2026-09-08T10:00:00.000Z',
    demo_delivered_at: '2026-09-08T09:00:00.000Z',
    demo_started: false, last_reject_target: null,
    demo_parca_approvals: [signed('KUTU'), signed('KİTAP')],
    parca_state: [routed('KUTU', 'demo'), routed('KİTAP', 'demo')],
    ...overrides,
  }
}

describe('adding a forgotten parça at demo_onay', () => {
  it('sends the round back to the matbaa', () => {
    const { project: next } = computeDemoEdit(demoOnay(), leader, addCtx())
    assert.equal(next.stage, 'demo_teslim')
  })

  it('takes the ÇİN leg back to cin_demo_teslim', () => {
    const { project: next } = computeDemoEdit(
      demoOnay({ type: 'CIN', stage: 'cin_demo_onay' }), leader, addCtx(),
    )
    assert.equal(next.stage, 'cin_demo_teslim')
  })

  it('keeps the sign-offs already given', () => {
    // The whole point. These two parçalar were printed and approved; the leader
    // must not be asked to do that again because a third one turned up.
    const { project: next } = computeDemoEdit(demoOnay(), leader, addCtx())
    assert.deepEqual(next.demo_parca_approvals.map((r) => r.parca), ['KUTU', 'KİTAP'])
  })

  it('leaves the routing table alone — no parcaStateResetGate', () => {
    // A reset here would put KUTU and KİTAP back in the matbaa's queue as work
    // they owe, on a round where they have already delivered both. Contrast the
    // resend leg, which sets this deliberately.
    const result = computeDemoEdit(demoOnay(), leader, addCtx())
    assert.equal(result.parcaStateResetGate, undefined)
  })

  it('clears the receipt so the new delivery has to be taken', () => {
    const { project: next } = computeDemoEdit(demoOnay(), leader, addCtx())
    assert.equal(next.demo_received, false)
    assert.equal(next.demo_received_at, null)
    assert.equal(next.demo_delivered_at, null)
  })

  it('does not bump demo_attempt — this is the same round going back out', () => {
    // Bumping would strand the sheet this very save wrote under the previous
    // attempt, and renumber a round the matbaa has already half-produced.
    const { project: next } = computeDemoEdit(demoOnay(), leader, addCtx())
    assert.equal(next.demo_attempt, 2)
  })

  it('records where the round went in the history entry', () => {
    const { history } = computeDemoEdit(demoOnay(), leader, addCtx())
    assert.equal(history.from_stage, 'demo_onay')
    assert.equal(history.to_stage, 'demo_teslim')
    assert.match(history.note, /KILAVUZ/)
    assert.match(history.note, /matbaaya geri gönderildi/)
  })

  it('lifts a held demo — this send is the re-send it was waiting for', () => {
    // Left set, availableActions would hide Onayla on the way back. If the
    // design is still short of 100%, the next approve simply holds it again.
    const { project: next } = computeDemoEdit(
      demoOnay({ demo_held: true, progress: 60 }), leader, addCtx(),
    )
    assert.equal(next.demo_held, false)
  })

  it('drops a pending Ekran Demo Onayı request on the way out', () => {
    // Approve and reject for it both require the demo_onay stage, so carrying
    // it out would block every future request with no way to clear it.
    const { project: next } = computeDemoEdit(
      demoOnay({ ekran_demo_requested_at: '2026-09-08T11:00:00.000Z' }), leader, addCtx(),
    )
    assert.equal(next.ekran_demo_requested_at, null)
  })
})

describe('what is still refused at demo_onay', () => {
  it('refuses an ordinary correction — the matbaa holds no sheet there', () => {
    assert.throws(
      () => computeDemoEdit(demoOnay(), leader, {
        parcaSetDelta: { added: [], removed: [] }, changedParcalar: ['KUTU'],
      }),
      /yalnızca gönderilmemiş parçalar eklenebilir/,
    )
  })

  it('refuses an add flag that adds nothing', () => {
    assert.throws(
      () => computeDemoEdit(demoOnay(), leader, {
        allowParcaAdd: true, parcaSetDelta: { added: [], removed: [] },
      }),
      /yalnızca gönderilmemiş parçalar eklenebilir/,
    )
  })

  it('still refuses removing a parça', () => {
    assert.throws(
      () => computeDemoEdit(demoOnay(), leader, {
        allowParcaAdd: true, parcaSetDelta: { added: ['KILAVUZ'], removed: ['KUTU'] },
      }),
      /parça çıkarılamaz/,
    )
  })

  it('still refuses a parça that has already been routed', () => {
    // KILAVUZ has a demo-gate row, so it is out for rework or already decided —
    // not fresh work, whatever the client believes.
    assert.throws(
      () => computeDemoEdit(
        demoOnay({ parca_state: [routed('KUTU', 'demo'), routed('KILAVUZ', 'demo')] }),
        leader,
        addCtx(),
      ),
      /KILAVUZ/,
    )
  })

  it('is still team-leader-only', () => {
    assert.throws(
      () => computeDemoEdit(demoOnay(), { id: 'u-d', role: 'designer', name: 'Aylin' }, addCtx()),
      /yalnızca ekip lideri/,
    )
  })

  it('leaves the demo_teslim window exactly as it was', () => {
    // The ordinary correction on a sheet the matbaa IS holding still works and
    // still does not move the project.
    const { project: next } = computeDemoEdit(
      demoOnay({ stage: 'demo_teslim', demo_received: false }), leader,
      { parcaSetDelta: { added: [], removed: [] }, changedParcalar: ['KUTU'] },
    )
    assert.equal(next.stage, 'demo_teslim')
  })
})

/** The ozalit leg, same rule. */
function ozalitOnay(overrides = {}) {
  return {
    id: 'p-2', type: 'TR', stage: 'ozalit_onay',
    progress: 100, ozalit_attempt: 1,
    ozalit_requested: false, ozalit_started: false, ozalit_received: true,
    ozalit_delivered_at: '2026-09-08T09:00:00.000Z',
    last_reject_target: null,
    ozalit_parca_approvals: { KUTU: [{ id: leader.id }], KİTAP: [{ id: leader.id }] },
    parca_state: [routed('KUTU', 'ozalit'), routed('KİTAP', 'ozalit')],
    ...overrides,
  }
}

describe('adding a forgotten parça at ozalit_onay', () => {
  it('sends the round back to the matbaa', () => {
    const { project: next } = computeOzalitEdit(ozalitOnay(), leader, addCtx())
    assert.equal(next.stage, 'ozalit_teslim')
  })

  it('marks the round requested again so the matbaa may deliver it', () => {
    // The delivery on the way in cleared this, and computeOzalitTeslimAdvance
    // refuses a round nobody requested.
    const { project: next } = computeOzalitEdit(ozalitOnay(), leader, addCtx())
    assert.equal(next.ozalit_requested, true)
    assert.equal(next.ozalit_received, false)
  })

  it('keeps the per-parça ledger and the routing rows', () => {
    const result = computeOzalitEdit(ozalitOnay(), leader, addCtx())
    assert.deepEqual(Object.keys(result.project.ozalit_parca_approvals), ['KUTU', 'KİTAP'])
    assert.equal(result.parcaStateResetGate, undefined)
  })

  it('does not bump ozalit_attempt', () => {
    const { project: next } = computeOzalitEdit(ozalitOnay(), leader, addCtx())
    assert.equal(next.ozalit_attempt, 1)
  })

  it('refuses an ordinary correction there', () => {
    assert.throws(
      () => computeOzalitEdit(ozalitOnay(), leader, {
        parcaSetDelta: { added: [], removed: [] }, changedParcalar: ['KUTU'],
      }),
      /yalnızca gönderilmemiş parçalar eklenebilir/,
    )
  })
})
