/**
 * Per-parça rejection (migrations 068/069/070):
 *
 *   `parcalar: string[]` → partial reject: only the targeted parçalar's
 *                           approval rows are cleared; the rest stay
 *                           locked, so a designer can rebuild just KUTU
 *                           and leave KAPAK at the leader's sign-off.
 *
 *   `parcalar: null` / `undefined` → whole-round reject (full ledger
 *                                    reset, same as the pre-migration
 *                                    behaviour).
 *
 * Only the demo_onay / cin_demo_onay / ozalit_onay stages accept a
 * per-parça reject — see computeRejection's gate. The whole-round
 * branch keeps working on every other stage.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeRejection } from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }
const ctx = { actorName: leader.name, actor: leader }

function demoOnayProject(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_onay',
    demo_received: true,
    demo_parca_approvals: [],
    demo_parca_rejections: [],
    assignees: [{ id: 'u-d', name: 'Aylin' }],
    subtasks: [{ id: 's1', kind: 'check', is_done: true }],
    ...overrides,
  }
}

describe('per-parça demo rejection (migrations 068/069/070)', () => {
  it('a partial reject clears only the targeted parça’s approval row', () => {
    const p = demoOnayProject({
      demo_parca_approvals: [
        { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: 't1' },
        { parca: 'KUTU', by: 'u-l', by_name: 'Ayşenur', at: 't2' },
      ],
    })
    const { project: next } = computeRejection(
      p, 'KAPAK tasarımı hatalı', [], 'designer',
      { actorName: leader.name, actor: leader, parcalar: ['KAPAK'] },
    )
    // Migration 074: a PER-PARÇA reject leaves the project where it is. Two
    // parties can hold different parçalar of one project at once, so no single
    // stage is true for the project — the stage stays at the approval gate and
    // parca_state carries the detail. (A whole-round reject still moves it;
    // that case is asserted further down.)
    assert.equal(next.stage, 'demo_onay')
    // KAPAK's row is cleared; KUTU's stays.
    const approved = next.demo_parca_approvals.map((r) => r.parca).sort()
    assert.deepEqual(approved, ['KUTU'])
    const rejected = next.demo_parca_rejections.map((r) => r.parca).sort()
    assert.deepEqual(rejected, ['KAPAK'])
  })

  it('a partial reject records reason + target on the cleared parça', () => {
    const p = demoOnayProject({
      demo_parca_approvals: [
        { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: 't1' },
      ],
    })
    const { project: next } = computeRejection(
      p, 'renk skalası yanlış', [], 'designer',
      { actorName: leader.name, actor: leader, parcalar: ['KAPAK'] },
    )
    assert.equal(next.demo_parca_rejections.length, 1)
    const row = next.demo_parca_rejections[0]
    assert.equal(row.parca, 'KAPAK')
    assert.equal(row.reason, 'renk skalası yanlış')
    assert.equal(row.target, 'designer')
    assert.equal(row.by, leader.id)
    assert.equal(row.by_name, leader.name)
  })

  it('whole-round reject (parcalar omitted) wipes the full ledger', () => {
    const p = demoOnayProject({
      demo_parca_approvals: [
        { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: 't1' },
        { parca: 'KUTU', by: 'u-l', by_name: 'Ayşenur', at: 't2' },
      ],
    })
    const { project: next } = computeRejection(
      p, 'her şey yanlış', [], 'designer',
      { actorName: leader.name, actor: leader }, // no parcalar → whole-round
    )
    assert.equal(next.stage, 'tasarim')
    assert.deepEqual(next.demo_parca_approvals, [])
    assert.deepEqual(next.demo_parca_rejections, [])
  })

  it('parcalar=[] is treated as a no-op for per-parça — falls back to whole-round', () => {
    // Empty array → sanitiser returns [] → isPartial is false → whole
    // round reject. The legacy code path handles parcalar=[] the same
    // way as parcalar=null.
    const p = demoOnayProject({
      demo_parca_approvals: [
        { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: 't1' },
      ],
    })
    const { project: next } = computeRejection(
      p, 'her şey yanlış', [], 'designer',
      { actorName: leader.name, actor: leader, parcalar: [] },
    )
    assert.equal(next.stage, 'tasarim')
    assert.deepEqual(next.demo_parca_approvals, [])
  })

  it('parcalar with an unknown parça name is rejected (silent typo safe)', () => {
    // Unknown parçalar drop out via the filter; if the resulting target
    // is empty AND there's something pending, the FSM throws.
    const p = demoOnayProject({
      demo_parca_approvals: [
        { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: 't1' },
      ],
    })
    // The leader tries to reject "YANLIS_AD" — that's not on the
    // snapshot, the sanitiser passes it through, but the rest of the
    // pipeline treats it as no-op since there's nothing to drop from
    // the ledger. Whole-round semantics still apply.
    assert.doesNotThrow(() =>
      computeRejection(
        p, 'her şey yanlış', [], 'designer',
        { actorName: leader.name, actor: leader, parcalar: ['YANLIS_AD'] },
      ),
    )
  })

  it('matbaa-target per-parça reject hands the parça over without moving the project', () => {
    // Same shape, but `target` is `matbaa`. Migration 074: the project stays
    // put and the handover is recorded per parça instead — the whole point is
    // that KAPAK can be at the matbaa while KUTU stays signed off and any
    // other parça is with the designer. The old behaviour (stage → demo_teslim,
    // reject_target → 'matbaa') belongs to a whole-round reject only.
    const p = demoOnayProject({
      demo_parca_approvals: [
        { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: 't1' },
        { parca: 'KUTU', by: 'u-l', by_name: 'Ayşenur', at: 't2' },
      ],
    })
    const { project: next, parcaState } = computeRejection(
      p, 'matbaa yeniden bassın', [], 'matbaa',
      { actorName: leader.name, actor: leader, parcalar: ['KAPAK'] },
    )
    assert.equal(next.stage, 'demo_onay')
    // The project-level re-delivery lock is NOT set: it would send the whole
    // sheet back to the matbaa.
    assert.notEqual(next.reject_target, 'matbaa')
    assert.deepEqual(
      next.demo_parca_approvals.map((r) => r.parca).sort(),
      ['KUTU'],
    )
    // The handover lives on the parça's routing row instead.
    assert.equal(parcaState.length, 1)
    assert.equal(parcaState[0].parca, 'KAPAK')
    assert.equal(parcaState[0].patch.owner_role, 'printer')
    assert.equal(parcaState[0].patch.state, 'with_matbaa')
  })

  it('a per-parça reject leaves the receipt and round counter alone', () => {
    // The regression that made this rule explicit: writing the project-level
    // reject scalars on a partial reject cleared demo_received, which shuts the
    // approval gate on every parça that came back FINE — the leader could then
    // neither receive nor approve, and the round was frozen by one parça.
    const p = demoOnayProject({
      demo_attempt: 2,
      demo_parca_approvals: [{ parca: 'KUTU', by: 'u-l', by_name: 'Ayşenur', at: 't1' }],
    })
    const { project: next } = computeRejection(
      p, 'KAPAK bozuk', [], 'designer',
      { actorName: leader.name, actor: leader, parcalar: ['KAPAK'] },
    )
    assert.equal(next.demo_received, true, 'the leader is still reviewing the rest')
    assert.equal(next.demo_attempt, 2, 'the project round did not restart')
    assert.equal(next.last_reject_type, undefined, 'no project-wide reject leg')
  })
})

describe('per-parça ozalit rejection (migrations 068/069/070)', () => {
  function ozalitOnayProject(overrides = {}) {
    return {
      id: 'p-2', type: 'TR', stage: 'ozalit_onay',
      ozalit_received: true,
      ozalit_approvals: [],
      ozalit_parca_approvals: {},
      ozalit_parca_rejections: [],
      assignees: [{ id: 'u-d', name: 'Aylin' }],
      subtasks: [{ id: 's1', kind: 'check', is_done: true }],
      ...overrides,
    }
  }

  it('a per-parça ozalit reject clears only the targeted parça’s approvals', () => {
    const p = ozalitOnayProject({
      ozalit_parca_approvals: {
        KAPAK: [
          { id: 'u-l', role: 'team_leader', name: 'Ayşenur', at: 't1' },
          { id: 'u-d', role: 'designer', name: 'Aylin', at: 't2' },
        ],
        KUTU: [
          { id: 'u-l', role: 'team_leader', name: 'Ayşenur', at: 't1' },
        ],
      },
    })
    const { project: next } = computeRejection(
      p, 'KAPAK çizimi bozuk', [], 'designer',
      { actorName: leader.name, actor: leader, parcalar: ['KAPAK'] },
    )
    // Whole-round reject to designer stays on ozalit_onay (the in-place
    // redo leg from migration 038).
    assert.equal(next.stage, 'ozalit_onay')
    // KAPAK cleared, KUTU's leader row stays.
    assert.equal(next.ozalit_parca_approvals.KAPAK, undefined)
    assert.equal(next.ozalit_parca_approvals.KUTU.length, 1)
  })

  it('whole-round ozalit reject wipes the project-level ledger but keeps nothing per-parça', () => {
    const p = ozalitOnayProject({
      ozalit_parca_approvals: {
        KAPAK: [{ id: 'u-l', role: 'team_leader', name: 'Ayşenur', at: 't1' }],
      },
      ozalit_approvals: [
        { id: 'u-l', role: 'team_leader', name: 'Ayşenur', at: 't1' },
      ],
    })
    const { project: next } = computeRejection(
      p, 'her şey yanlış', [], 'designer',
      { actorName: leader.name, actor: leader },
    )
    assert.deepEqual(next.ozalit_approvals, [])
    assert.deepEqual(next.ozalit_parca_approvals, {})
  })
})

describe('per-parça reject gate', () => {
  it('refuses per-parça reject on a stage that doesn’t support it', () => {
    // The plan limits per-parça reject to demo/ozalit approve stages.
    // Anywhere else (e.g. tasarim) is defensively refused.
    const p = {
      id: 'p-3', type: 'TR', stage: 'tasarim',
      demo_received: true,
      demo_parca_approvals: [],
      assignees: [{ id: 'u-d', name: 'Aylin' }],
      subtasks: [],
    }
    assert.throws(
      () => computeRejection(
        p, 'test', [], 'designer',
        { actorName: leader.name, actor: leader, parcalar: ['KAPAK'] },
      ),
      /Parça bazlı red yalnızca demo ve ozalit onay aşamalarında yapılabilir/,
    )
  })
})

/**
 * Cross-gate ledger isolation (Phase 0 fix).
 *
 * The demo and ozalit halves of computeRejection's per-parça block each own a
 * pair — approvals + rejections — and both halves must answer to `isOzalit`.
 * They used to disagree, in mirror-image ways:
 *
 *   • demo_parca_rejections was appended UNCONDITIONALLY, so an ozalit reject
 *     wrote a row into the demo ledger for a demo round that wasn't happening.
 *     That row is not inert: rejectedParcalar() reads it, and ParcaApprovalRow
 *     resolves `rejected` before `approved`, so a LATER demo round rendered an
 *     approved parça as "Reddedildi".
 *
 *   • ozalit_parca_approvals was dropped UNCONDITIONALLY, so a demo reject
 *     silently discarded ozalit sign-offs for that parça.
 */
describe('per-parça reject keeps the two gates’ ledgers apart', () => {
  it('an ozalit reject leaves the demo ledgers untouched', () => {
    const p = {
      id: 'p-x', type: 'TR', stage: 'ozalit_onay',
      ozalit_received: true,
      ozalit_approvals: [],
      ozalit_parca_approvals: { KAPAK: [{ id: 'u-l', name: 'Ayşenur', at: 't1' }] },
      ozalit_parca_rejections: [],
      // Left over from this project's earlier demo round.
      demo_parca_approvals: [{ parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: 't0' }],
      demo_parca_rejections: [],
      assignees: [{ id: 'u-d', name: 'Aylin' }],
      subtasks: [{ id: 's1', kind: 'check', is_done: true }],
    }
    const { project: next } = computeRejection(
      p, 'kerning hatalı', [], 'designer',
      { actorName: leader.name, actor: leader, parcalar: ['KAPAK'] },
    )
    // The ozalit half did its job.
    assert.deepEqual(next.ozalit_parca_approvals, {})
    assert.equal(next.ozalit_parca_rejections.length, 1)
    assert.equal(next.ozalit_parca_rejections[0].parca, 'KAPAK')
    // …and the demo half was not touched at all.
    assert.deepEqual(next.demo_parca_approvals, p.demo_parca_approvals)
    assert.deepEqual(next.demo_parca_rejections, [])
  })

  it('a demo reject leaves the ozalit ledgers untouched', () => {
    const p = {
      id: 'p-y', type: 'TR', stage: 'demo_onay',
      demo_received: true,
      demo_parca_approvals: [
        { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: 't0' },
        { parca: 'KUTU', by: 'u-l', by_name: 'Ayşenur', at: 't0' },
      ],
      demo_parca_rejections: [],
      ozalit_parca_approvals: { KAPAK: [{ id: 'u-l', name: 'Ayşenur', at: 't1' }] },
      ozalit_parca_rejections: [],
      assignees: [{ id: 'u-d', name: 'Aylin' }],
      subtasks: [{ id: 's1', kind: 'check', is_done: true }],
    }
    const { project: next } = computeRejection(
      p, 'renk kayması', [], 'designer',
      { actorName: leader.name, actor: leader, parcalar: ['KAPAK'] },
    )
    // The demo half did its job: KAPAK dropped, KUTU still signed.
    assert.deepEqual(next.demo_parca_approvals.map((r) => r.parca), ['KUTU'])
    assert.equal(next.demo_parca_rejections.length, 1)
    // …and the ozalit half was not touched at all.
    assert.deepEqual(next.ozalit_parca_approvals, p.ozalit_parca_approvals)
    assert.deepEqual(next.ozalit_parca_rejections, [])
  })
})

/**
 * The timeline row has to name the parça (migration 073). Without it the
 * history of a three-parça round reads "Parça bazlı red" three times over,
 * and the only record of WHICH parça was bounced sits in a JSONB column that
 * nothing renders.
 */
describe('per-parça reject names the parça on the history row', () => {
  it('stamps `parca` and a readable note, and says where it went', () => {
    const p = {
      id: 'p-h', type: 'TR', stage: 'demo_onay',
      demo_received: true,
      demo_parca_approvals: [], demo_parca_rejections: [],
      ozalit_parca_approvals: {}, ozalit_parca_rejections: [],
      assignees: [{ id: 'u-d', name: 'Aylin' }],
      subtasks: [{ id: 's1', kind: 'check', is_done: true }],
    }
    const { history } = computeRejection(
      p, 'renk kayması', [], 'designer',
      { actorName: leader.name, actor: leader, parcalar: ['KAPAK', 'KUTU'] },
    )
    assert.equal(history.parca, 'KAPAK, KUTU')
    assert.match(history.note, /KAPAK, KUTU/)
    assert.match(history.note, /tasarımcıya/)
    assert.equal(history.action, 'reject')
  })

  it('names the matbaa when that is the target', () => {
    const p = {
      id: 'p-h2', type: 'TR', stage: 'demo_onay',
      demo_received: true,
      demo_parca_approvals: [], demo_parca_rejections: [],
      ozalit_parca_approvals: {}, ozalit_parca_rejections: [],
      assignees: [{ id: 'u-d', name: 'Aylin' }],
      subtasks: [{ id: 's1', kind: 'check', is_done: true }],
    }
    const { history } = computeRejection(
      p, 'baskı lekeli', [], 'matbaa',
      { actorName: leader.name, actor: leader, parcalar: ['KUTU'] },
    )
    assert.equal(history.parca, 'KUTU')
    assert.match(history.note, /matbaaya/)
  })

  it('leaves `parca` unset on a whole-round reject', () => {
    const p = {
      id: 'p-h3', type: 'TR', stage: 'demo_onay',
      demo_received: true,
      demo_parca_approvals: [], demo_parca_rejections: [],
      ozalit_parca_approvals: {}, ozalit_parca_rejections: [],
      assignees: [{ id: 'u-d', name: 'Aylin' }],
      subtasks: [{ id: 's1', kind: 'check', is_done: true }],
    }
    const { history } = computeRejection(
      p, 'her şey yanlış', [], 'designer',
      { actorName: leader.name, actor: leader },
    )
    assert.equal(history.parca, undefined)
  })
})

/**
 * ÇİN gains a matbaa re-delivery leg.
 *
 * `toMatbaa` used to require `project.type === 'TR'`, so a ÇİN demo rejected to
 * the matbaa fell through to `tasarim` and landed on the designer — who had
 * nothing to fix, because the complaint was about the print, not the design.
 * The remaining `endsWith('_teslim')` test is what actually guards this, and
 * STAGE_PIPELINE.CIN carries `cin_demo_teslim`, so ÇİN satisfies it on its own.
 */
describe('matbaa re-delivery works on ÇİN, not just TR', () => {
  function cinDemoOnay(overrides = {}) {
    return {
      id: 'p-cin', type: 'CIN', stage: 'cin_demo_onay',
      demo_received: true, demo_attempt: 1,
      demo_parca_approvals: [], demo_parca_rejections: [],
      ozalit_parca_approvals: {}, ozalit_parca_rejections: [],
      assignees: [{ id: 'u-d', name: 'Aylin' }],
      subtasks: [{ id: 's1', kind: 'check', is_done: true }],
      ...overrides,
    }
  }

  it('a whole-round ÇİN reject to the matbaa goes back to cin_demo_teslim', () => {
    const { project: next } = computeRejection(
      cinDemoOnay(), 'baskı lekeli', [], 'matbaa',
      { actorName: leader.name, actor: leader },
    )
    assert.equal(next.stage, 'cin_demo_teslim')
    assert.equal(next.reject_target, 'matbaa')
  })

  it('a ÇİN reject to the designer still goes to tasarim', () => {
    const { project: next } = computeRejection(
      cinDemoOnay(), 'tasarım hatalı', [], 'designer',
      { actorName: leader.name, actor: leader },
    )
    assert.equal(next.stage, 'tasarim')
  })

  it('a per-parça ÇİN reject to the matbaa hands over just that parça', () => {
    const { project: next, parcaState } = computeRejection(
      cinDemoOnay(), 'KUTU lekeli', [], 'matbaa',
      { actorName: leader.name, actor: leader, parcalar: ['KUTU'] },
    )
    assert.equal(next.stage, 'cin_demo_onay', 'the project stays at the gate')
    assert.equal(parcaState[0].patch.owner_role, 'printer')
  })

  it('a stage with no teslim leg before it still cannot route to the matbaa', () => {
    // baski_onay's predecessor is ozalit_onay, not a *_teslim stage — the
    // guard that survives is the one doing the real work.
    const p = {
      id: 'p-b', type: 'TR', stage: 'baski_onay',
      demo_received: true, assignees: [], subtasks: [],
      demo_parca_approvals: [], demo_parca_rejections: [],
      ozalit_parca_approvals: {}, ozalit_parca_rejections: [],
    }
    const { project: next } = computeRejection(
      p, 'yanlış', [], 'matbaa', { actorName: leader.name, actor: leader },
    )
    assert.equal(next.stage, 'tasarim')
  })
})

/**
 * Subtask revize flags follow the parça (migration 075).
 *
 * Before this, a per-parça reject had two equally wrong options: flag every
 * subtask (implying the whole project came back) or flag none (leaving the
 * designer to guess what to redo). Neither survives a project where KUTU is
 * approved and only KİTAP came back.
 */
describe('a per-parça reject flags only that parça’s subtasks', () => {
  function projectWithParcaSubtasks() {
    return {
      id: 'p-sub', type: 'TR', stage: 'demo_onay',
      demo_received: true, demo_attempt: 1,
      demo_parca_approvals: [], demo_parca_rejections: [],
      ozalit_parca_approvals: {}, ozalit_parca_rejections: [],
      assignees: [{ id: 'u-d', name: 'Aylin' }],
      subtasks: [
        { id: 's-kapak', kind: 'check', is_done: true, parca: 'KİTAP' },
        { id: 's-ic', kind: 'check', is_done: true, parca: 'KİTAP' },
        { id: 's-kutu', kind: 'check', is_done: true, parca: 'KUTU' },
        // No parça — project-wide work, e.g. "Yazılım".
        { id: 's-genel', kind: 'check', is_done: true, parca: null },
      ],
    }
  }

  it('flags the rejected parça’s subtasks and leaves the others alone', () => {
    const { project: next } = computeRejection(
      projectWithParcaSubtasks(), 'kerning bozuk', [], 'designer',
      { actorName: leader.name, actor: leader, parcalar: ['KİTAP'] },
    )
    const flagged = next.subtasks.filter((s) => s.needs_revize).map((s) => s.id).sort()
    assert.deepEqual(flagged, ['s-ic', 's-kapak'])
  })

  it('leaves a project-wide subtask alone unless the leader picked it', () => {
    // A NULL-parça subtask is not implicated by any one parça, so it stays
    // the leader's explicit revizeIds choice — the pre-075 behaviour.
    const { project: next } = computeRejection(
      projectWithParcaSubtasks(), 'kerning bozuk', [], 'designer',
      { actorName: leader.name, actor: leader, parcalar: ['KİTAP'] },
    )
    assert.equal(next.subtasks.find((s) => s.id === 's-genel').needs_revize, undefined)
  })

  it('still honours the leader’s explicit picks for project-wide subtasks', () => {
    const { project: next } = computeRejection(
      projectWithParcaSubtasks(), 'kerning bozuk', ['s-genel'], 'designer',
      { actorName: leader.name, actor: leader, parcalar: ['KİTAP'] },
    )
    assert.equal(next.subtasks.find((s) => s.id === 's-genel').needs_revize, true)
  })

  it('does not touch subtasks at all on a matbaa-target reject', () => {
    // The design is unchanged — only the print was wrong.
    const { project: next } = computeRejection(
      projectWithParcaSubtasks(), 'baskı lekeli', [], 'matbaa',
      { actorName: leader.name, actor: leader, parcalar: ['KİTAP'] },
    )
    assert.ok(!next.subtasks.some((s) => s.needs_revize))
  })

  it('keeps the whole-round reject on the leader’s explicit picks', () => {
    const { project: next } = computeRejection(
      projectWithParcaSubtasks(), 'her şey yanlış', ['s-kutu'], 'designer',
      { actorName: leader.name, actor: leader },
    )
    const flagged = next.subtasks.filter((s) => s.needs_revize).map((s) => s.id)
    assert.deepEqual(flagged, ['s-kutu'])
  })
})
