/**
 * Demo flow rules: matbaa re-delivery numbering + re-send gating.
 *
 *   • Reject-to-matbaa re-delivers the SAME demo (design unchanged) and must
 *     NOT bump the attempt counter — only reject-to-designer starts a new one.
 *   • A demo re-send ("Demo İste") is only valid on a HELD demo. A demo still
 *     with the matbaa, or freshly delivered and awaiting the leader's decision,
 *     is in progress and must not be duplicated.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  computeAdvance, computeApproval, computeDemoReceive, computeDemoNotReceived, computeRejection,
} from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }
const ctx = { actorName: leader.name, actor: leader }

function demoProject(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_onay',
    demo_attempt: 5, ozalit_attempt: 0,
    reject_target: null, ozalit_requested: false,
    demo_held: false,
    // demo_received mirrors the live pipeline: every demo that's reached the
    // onay stage has been delivered, and a leader can only reject (or approve)
    // it once they've taken delivery — computeRejection now enforces this same
    // gate the approval flow has had since migration 035. Tests that need to
    // exercise the rejection path opt out via `demoReceived: false`.
    demo_received: true,
    assignees: [{ id: 'u-d', name: 'Aylin' }],
    subtasks: [{ id: 's1', kind: 'check', is_done: true }],
    ...overrides,
  }
}

describe('reject-to-matbaa numbering', () => {
  it('bumps demo_attempt like a designer reject (new numbered attempt)', () => {
    const { project: next } = computeRejection(
      demoProject(), 'matbaa yeniden bassın', [], 'matbaa', ctx,
    )
    assert.equal(next.stage, 'demo_teslim')       // back to the matbaa
    assert.equal(next.reject_target, 'matbaa')
    assert.equal(next.demo_attempt, 6)            // bumped — same as designer
  })

  it('leaves subtasks untouched on a matbaa reject (design unchanged)', () => {
    const { project: next } = computeRejection(
      demoProject(), 'matbaa yeniden bassın', [], 'matbaa', ctx,
    )
    // No subtask was flagged for revision — the design didn't change.
    assert.ok(!(next.subtasks ?? []).some((s) => s.needs_revize))
  })

  // The reprint is a genuinely new round for every parça — a stale parca_state
  // row from before this reject would make the new round's matbaa queue skip a
  // parça, and its delivery gate think that parça already arrived. See
  // deleteParcaStateForGate's comment.
  it('resets the demo gate\'s per-parça routing table', () => {
    const result = computeRejection(demoProject(), 'matbaa yeniden bassın', [], 'matbaa', ctx)
    assert.equal(result.parcaStateResetGate, 'demo')
  })

  // A PARTIAL (per-parça) reject-to-matbaa must not take this branch — it
  // already upserts exactly the one parça being sent back via `parcaState`,
  // and resetting the whole gate would erase every other parça's routing.
  it('does not reset the whole gate on a per-parça matbaa reject', () => {
    const result = computeRejection(
      demoProject(), 'matbaa yeniden bassın', [], 'matbaa',
      { ...ctx, parcalar: ['KUTU'] },
    )
    assert.equal(result.parcaStateResetGate, undefined)
  })

  it('reject-to-designer also bumps demo_attempt (genuine redesign)', () => {
    const { project: next } = computeRejection(
      demoProject(), 'tasarım değişsin', ['s1'], 'designer', ctx,
    )
    assert.equal(next.stage, 'tasarim')
    assert.equal(next.demo_attempt, 6)            // bumped
  })
})

// Regression: a reject used to leave demo_started (and the change-request/
// fix-pending ledger) stuck true from the PREVIOUS round. The matbaa's
// "İşlemi Başlatın" button never came back for the new round
// (canMarkDemoStarted requires !demo_started) while the leader/designer saw
// "Değişiklik İste" instead of a free cancel/edit (canRequestDemoChange
// requires demo_started) — for a round that hadn't even been redelivered yet.
describe('reject resets the matbaa "Başladım" ledger for a fresh round', () => {
  const startedProject = () => demoProject({
    demo_started: true,
    demo_started_at: '2026-01-01T00:00:00.000Z',
    demo_started_by: 'u-p',
    demo_started_by_name: 'Oktay',
    demo_change_requested_at: '2026-01-02T00:00:00.000Z',
    demo_change_requested_by: 'u-l',
    demo_change_requested_by_name: 'Ayşenur',
    demo_change_requested_note: 'renk yanlış',
    demo_fix_pending: true,
  })

  it('reject-to-designer clears demo_started/change-request/fix_pending', () => {
    const { project: next } = computeRejection(
      startedProject(), 'tasarım değişsin', ['s1'], 'designer', ctx,
    )
    assert.equal(next.demo_started, false)
    assert.equal(next.demo_started_at, null)
    assert.equal(next.demo_started_by, null)
    assert.equal(next.demo_started_by_name, null)
    assert.equal(next.demo_change_requested_at, null)
    assert.equal(next.demo_change_requested_by, null)
    assert.equal(next.demo_change_requested_by_name, null)
    assert.equal(next.demo_change_requested_note, null)
    assert.equal(next.demo_fix_pending, false)
  })

  it('reject-to-matbaa (re-delivery) also clears demo_started/change-request/fix_pending', () => {
    const { project: next } = computeRejection(
      startedProject(), 'matbaa yeniden bassın', [], 'matbaa', ctx,
    )
    assert.equal(next.stage, 'demo_teslim')
    assert.equal(next.demo_started, false)
    assert.equal(next.demo_change_requested_at, null)
    assert.equal(next.demo_fix_pending, false)
  })
})

describe('demo "Teslim Alındı" gate before Onay', () => {
  it('blocks the demo approve until the delivery is marked received', () => {
    assert.throws(
      () => computeApproval(demoProject({ demo_received: false, progress: 100 }), leader),
      /Teslim Alındı/,
    )
  })

  it('an assigned designer can mark the demo received', () => {
    const designer = { id: 'u-d', role: 'designer', name: 'Aylin' }
    const { project: next } = computeDemoReceive(
      demoProject({ demo_received: false }), designer, { designerIds: ['u-d'] },
    )
    assert.equal(next.demo_received, true)
    assert.equal(next.demo_received_by, 'Aylin')
  })

  it('a user who is neither leader nor assigned designer cannot mark it received', () => {
    const stranger = { id: 'u-x', role: 'designer', name: 'Biri' }
    assert.throws(
      () => computeDemoReceive(demoProject(), stranger, { designerIds: ['u-d'] }),
      /yalnızca ekip lideri veya atanmış tasarımcı/,
    )
  })

  it('approves and advances once received at 100%', () => {
    const { project: next } = computeApproval(
      demoProject({ demo_received: true, progress: 100 }), leader,
    )
    assert.equal(next.stage, 'ozalit_teslim')
  })

  it('a fresh delivery resets the received flag', () => {
    // Matbaa delivers demo_teslim → demo_onay; the ack must not carry over.
    const printer = { id: 'u-p', role: 'printer', name: 'Oktay' }
    const { project: next } = computeAdvance(
      demoProject({ stage: 'demo_teslim', demo_received: true, progress: 100 }), printer,
    )
    assert.equal(next.stage, 'demo_onay')
    assert.equal(next.demo_received, false)
  })
})

describe('demo re-send gating (demo_held)', () => {
  it('blocks re-send when the demo is not held (in progress, awaiting decision)', () => {
    assert.throws(
      () => computeAdvance(demoProject({ demo_held: false }), leader),
      /Devam eden bir demo/,
    )
  })

  it('allows re-send when the demo is held (designer finished, sending next round)', () => {
    const { project: next } = computeAdvance(demoProject({ demo_held: true }), leader)
    assert.equal(next.stage, 'demo_teslim')       // new round goes to the matbaa
    assert.equal(next.demo_attempt, 6)            // this IS a new demo — bump
    assert.equal(next.demo_held, false)           // hold cleared
  })

  // Same reasoning as the whole-round reject-to-matbaa test above: this round's
  // parça_state rows describe a demo that is being superseded, and reading them
  // against the new round is what corrupted the matbaa's queue and delivery
  // gate for a resent demo (see deleteParcaStateForGate).
  it('resets the demo gate\'s per-parça routing table on resend', () => {
    const result = computeAdvance(demoProject({ demo_held: true }), leader)
    assert.equal(result.parcaStateResetGate, 'demo')
  })
})

// The reset is scoped to leaving 'tasarim' specifically — not "any generic
// forward step". An ordinary mid-pipeline advance (here: past a plain,
// non-redo ozalit_onay) has no demo-gate parça_state of its own round to
// speak of, and must not reset one that belongs to an entirely different gate.
describe('generic advance does not touch parça routing outside tasarim', () => {
  it('leaves parcaStateResetGate unset advancing ozalit_onay → baski_onay', () => {
    const result = computeAdvance(
      demoProject({ stage: 'ozalit_onay', last_reject_type: null, progress: 100 }),
      leader,
    )
    assert.equal(result.project.stage, 'baski_onay')
    assert.equal(result.parcaStateResetGate, undefined)
  })
})

// Mirrors the demo-approval receipt gate: rejecting an un-received demo is
// the same logical mistake the client UI used to expose (Demoyu Reddedin
// before Demoyu Teslim Alın). computeRejection has to refuse it the same way
// computeApproval does, otherwise an old cached client or a hand-crafted
// API call could still bypass the UI guard.
describe('reject "Teslim Alındı" gate', () => {
  it('blocks reject until the demo is marked received', () => {
    assert.throws(
      () => computeRejection(
        demoProject({ demo_received: false }), 'tasarım değişsin', ['s1'], 'designer', ctx,
      ),
      /Teslim Alındı/,
    )
  })

  it('blocks reject-to-matbaa for cin_demo_onay too (same demo_received flag)', () => {
    const cinCtx = { actorName: leader.name, actor: leader }
    assert.throws(
      () => computeRejection(
        demoProject({ stage: 'cin_demo_onay', demo_received: false }),
        'matbaa yeniden bassın', [], 'matbaa', cinCtx,
      ),
      /Teslim Alındı/,
    )
  })

  it('proceeds once received', () => {
    const { project: next } = computeRejection(
      demoProject({ demo_received: true }), 'tasarım değişsin', ['s1'], 'designer', ctx,
    )
    assert.equal(next.stage, 'tasarim')
  })
})

// Per-parça gate (migrations 068/069/070): the demo_onay / cin_demo_onay
// advance refuses to leave demo_onay until every parça on the latest
// snapshot's `_selectedComponents` has the leader's sign-off in the
// per-parça ledger. The legacy single-parça shortcut (no snapshot) still
// advances on a single click — see the `'approves and advances once
// received at 100%'` test above.
describe('per-parça demo approval gate (migrations 068/069/070)', () => {
  const PARCALAR = ['KAPAK', 'KUTU', 'KILAVUZ']
  const leaderCtx = {
    actorName: 'Ayşenur',
    actor: { id: 'u-l', role: 'team_leader', name: 'Ayşenur' },
    snapshot: { selectedComponents: PARCALAR },
  }
  // The prepare hook passes ctx.snapshot, so use that shape here.
  function multiParcaProject(overrides = {}) {
    return demoProject({
      demo_parca_approvals: [],
      ...overrides,
    })
  }

  it('refuses to advance while any parça is unsigned', () => {
    // KAPAK already approved. The leader explicitly clicks "Onayla" on
    // KAPAK again (no-op by design — already approved) — KUTU + KILAVUZ
    // stay pending → the project stays at demo_onay.
    const p = multiParcaProject({
      demo_parca_approvals: [
        { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: '2026-01-01T00:00:00.000Z' },
      ],
      progress: 100,
    })
    const { project: next, history } = computeApproval(
      p,
      leader,
      { ...leaderCtx, parcalar: ['KUTU'] },
    )
    assert.equal(next.stage, 'demo_onay', 'stays put while parçalar pending')
    assert.equal(history.from_stage, 'demo_onay')
    assert.equal(history.to_stage, 'demo_onay')
    // The KAPAK + KUTU rows are recorded; KILAVUZ is still pending.
    const approved = next.demo_parca_approvals.map((r) => r.parca).sort()
    assert.deepEqual(approved, ['KAPAK', 'KUTU'])
  })

  it('advances once every parça is approved', () => {
    const p = multiParcaProject({
      demo_parca_approvals: [
        { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: '2026-01-01T00:00:00.000Z' },
        { parca: 'KUTU', by: 'u-l', by_name: 'Ayşenur', at: '2026-01-01T00:00:01.000Z' },
        { parca: 'KILAVUZ', by: 'u-l', by_name: 'Ayşenur', at: '2026-01-01T00:00:02.000Z' },
      ],
      progress: 100,
    })
    const { project: next } = computeApproval(p, leader, leaderCtx)
    assert.equal(next.stage, 'ozalit_teslim', 'all parçalar signed off → advance')
  })

  it('bulk-approve (parcalar omitted) signs off every pending parça at once', () => {
    const p = multiParcaProject({
      demo_parca_approvals: [
        { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: '2026-01-01T00:00:00.000Z' },
      ],
      progress: 100,
    })
    // No parcalar in ctx → server defaults to "approve all still-pending".
    const { project: next } = computeApproval(p, leader, leaderCtx)
    assert.equal(next.stage, 'ozalit_teslim')
  })

  it('a subset (parcalar) only approves the chosen parça', () => {
    // KAPAK already approved; user explicitly approves KUTU only — KILAVUZ
    // stays pending, so the project stays at demo_onay.
    const p = multiParcaProject({
      demo_parca_approvals: [
        { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: '2026-01-01T00:00:00.000Z' },
      ],
      progress: 100,
    })
    const { project: next } = computeApproval(
      p,
      leader,
      { ...leaderCtx, parcalar: ['KUTU'] },
    )
    assert.equal(next.stage, 'demo_onay')
    const approvedParcalar = next.demo_parca_approvals.map((r) => r.parca).sort()
    assert.deepEqual(approvedParcalar, ['KAPAK', 'KUTU'])
  })

  it('re-sending the demo with a different _selectedComponents drops orphaned approvals', () => {
    // A designer re-sends a demo without KILAVUZ. KILAVUZ's prior sign-off
    // must NOT count toward the next round's gate (the plan's "single source
    // of truth for the parça list" rule).
    const p = multiParcaProject({
      demo_parca_approvals: [
        { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: '2026-01-01T00:00:00.000Z' },
        { parca: 'KILAVUZ', by: 'u-l', by_name: 'Ayşenur', at: '2026-01-01T00:00:01.000Z' },
      ],
      progress: 100,
    })
    // The next round's snapshot lists only KAPAK + KUTU; KILAVUZ is gone.
    const newSnap = { selectedComponents: ['KAPAK', 'KUTU'] }
    const { project: next, history } = computeApproval(p, leader, {
      ...leaderCtx,
      snapshot: newSnap,
      parcalar: ['KAPAK', 'KUTU'],
    })
    // KUTU newly approved; KAPAK already approved → all signed off → advance.
    assert.equal(next.stage, 'ozalit_teslim')
    // The ledger is pruned — KILAVUZ no longer counts.
    const approvedParcalar = next.demo_parca_approvals.map((r) => r.parca).sort()
    assert.deepEqual(approvedParcalar, ['KAPAK', 'KUTU'])
  })

  it('at <100% progress: per-parça approve holds the demo', () => {
    const p = multiParcaProject({
      progress: 50,
      demo_parca_approvals: [],
    })
    const { project: next } = computeApproval(p, leader, leaderCtx)
    assert.equal(next.stage, 'demo_onay', 'held below 100%')
    assert.equal(next.demo_held, true)
    assert.equal(next.demo_parca_approvals.length, PARCALAR.length)
  })

  it('refuses to complete a held demo once progress catches up to 100%', () => {
    // The hold above already recorded every parça's sign-off (the leader
    // approved everything on offer at <100%). Without the guard, the very
    // next approve — issued once the design finished — found `pending` empty
    // from that stale ledger and slid the round straight through with nobody
    // having looked at the finished design.
    const p = multiParcaProject({
      progress: 100,
      demo_held: true,
      demo_parca_approvals: PARCALAR.map((parca) => (
        { parca, by: 'u-l', by_name: 'Ayşenur', at: '2026-01-01T00:00:00.000Z' }
      )),
    })
    assert.throws(
      () => computeApproval(p, leader, leaderCtx),
      /demo askıda/,
    )
  })

  it('still allows a held demo to be signed off further while under 100%', () => {
    // The narrow guard only blocks the ≥100% completion path — a partial
    // sign-off recorded while genuinely still held must keep working.
    const p = multiParcaProject({
      progress: 60,
      demo_held: true,
      demo_parca_approvals: [
        { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: '2026-01-01T00:00:00.000Z' },
      ],
    })
    const { project: next } = computeApproval(
      p, leader, { ...leaderCtx, parcalar: ['KUTU'] },
    )
    assert.equal(next.stage, 'demo_onay')
    assert.equal(next.demo_held, true)
    const approved = next.demo_parca_approvals.map((r) => r.parca).sort()
    assert.deepEqual(approved, ['KAPAK', 'KUTU'])
  })

  it('a partial reject clears only the rejected parça’s approval', () => {
    const p = multiParcaProject({
      demo_parca_approvals: [
        { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: '2026-01-01T00:00:00.000Z' },
        { parca: 'KUTU', by: 'u-l', by_name: 'Ayşenur', at: '2026-01-01T00:00:01.000Z' },
      ],
      demo_received: true,
    })
    // Leader rejects only KAPAK — KUTU's approval must stay locked.
    const { project: next } = computeRejection(
      p, 'KAPAK tasarımı hatalı', [], 'designer',
      { actorName: 'Ayşenur', actor: leader, parcalar: ['KAPAK'] },
    )
    // Migration 074: a per-parça reject leaves the project at the gate. KUTU is
    // still signed off and the leader can carry on with it; only KAPAK went
    // back, and to the designer's desk rather than the whole project's.
    assert.equal(next.stage, 'demo_onay')
    const approvedParcalar = next.demo_parca_approvals.map((r) => r.parca).sort()
    assert.deepEqual(approvedParcalar, ['KUTU'])
    const rejectedParcalar = next.demo_parca_rejections.map((r) => r.parca).sort()
    assert.deepEqual(rejectedParcalar, ['KAPAK'])
  })
})

/**
 * Regression: a new demo round must not inherit the previous round's per-parça
 * sign-offs.
 *
 * Nothing cleared `demo_parca_approvals` when a round ended any way other than
 * a whole-round reject. The damaging case is the HELD demo: an approve at
 * <100% progress deliberately records every parça and holds the project, so
 * the ledger arrives at the NEXT round already full — `demoPendingParcalar`
 * then found nothing owed, and the first Onayla on a freshly printed demo
 * advanced the project with nobody having looked at it.
 */
describe('a new demo round starts with an empty per-parça ledger', () => {
  const SNAPSHOT = ['KİTAP', 'KUTU']
  const heldWithLedger = (overrides = {}) => demoProject({
    demo_held: true,
    progress: 100,
    demo_parca_approvals: SNAPSHOT.map((parca) => ({ parca, by: 'u-l', by_name: 'Ayşenur' })),
    demo_parca_rejections: [{ parca: 'KUTU', target: 'matbaa' }],
    ...overrides,
  })

  it('clears it on a re-send ("Demo İste") of a held demo', () => {
    const { project: next } = computeAdvance(heldWithLedger(), leader)
    assert.equal(next.stage, 'demo_teslim')
    assert.equal(next.demo_attempt, 6)
    assert.deepEqual(next.demo_parca_approvals, [])
    assert.deepEqual(next.demo_parca_rejections, [])
  })

  it('clears it on "Teslim Alınamadı"', () => {
    const { project: next } = computeDemoNotReceived(
      heldWithLedger({ demo_received: false }), leader, { designerIds: ['u-d'] },
    )
    assert.equal(next.stage, 'demo_teslim')
    assert.deepEqual(next.demo_parca_approvals, [])
    assert.deepEqual(next.demo_parca_rejections, [])
  })

  // The point of the reset, end to end: the round that follows a hold has to
  // collect real signatures before it can move.
  it('so the next round needs fresh signatures before it can advance', () => {
    const resent = computeAdvance(heldWithLedger(), leader).project
    const delivered = {
      ...resent, stage: 'demo_onay', demo_received: true, progress: 100,
    }
    const snap = { snapshot: { selectedComponents: SNAPSHOT } }

    // Signing one parça holds the project — previously this advanced it,
    // because the old ledger already covered both.
    const partial = computeApproval(delivered, leader, { ...snap, parcalar: ['KİTAP'] })
    assert.equal(partial.project.stage, 'demo_onay')
    assert.equal(partial.project.demo_parca_approvals.length, 1)

    // Signing the rest advances it, on that same click.
    const done = computeApproval(partial.project, leader, { ...snap, parcalar: ['KUTU'] })
    assert.equal(done.project.stage, 'ozalit_teslim')
  })
})
