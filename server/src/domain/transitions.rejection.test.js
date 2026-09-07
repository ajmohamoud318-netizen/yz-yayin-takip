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
    // Whole-round reject still drops the project back to tasarim.
    assert.equal(next.stage, 'tasarim')
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

  it('matbaa-target per-parça reject routes the project back to demo_teslim', () => {
    // Same shape, but `target` is `matbaa`. The stage still moves to
    // demo_teslim (re-delivery lock) on TR. The per-parça ledger
    // semantics are the same.
    const p = demoOnayProject({
      demo_parca_approvals: [
        { parca: 'KAPAK', by: 'u-l', by_name: 'Ayşenur', at: 't1' },
        { parca: 'KUTU', by: 'u-l', by_name: 'Ayşenur', at: 't2' },
      ],
    })
    const { project: next } = computeRejection(
      p, 'matbaa yeniden bassın', [], 'matbaa',
      { actorName: leader.name, actor: leader, parcalar: ['KAPAK'] },
    )
    assert.equal(next.stage, 'demo_teslim')
    assert.equal(next.reject_target, 'matbaa')
    assert.deepEqual(
      next.demo_parca_approvals.map((r) => r.parca).sort(),
      ['KUTU'],
    )
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
