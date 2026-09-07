/**
 * Baskı Onayı dual-approval rules (migrations 045/070):
 *
 *   • Migration 045: the whole-project baski_onay_prepared flag —
 *     one leader prepares, a DIFFERENT leader approves.
 *   • Migration 070: the same dual-leader rule, scoped to each parça on
 *     the latest baskı_onay snapshot. The maker-checker rule applies
 *     per parça: a leader who prepared KUTU may still approve KAPAK if
 *     someone else prepared KAPAK.
 *
 * The legacy project-level baski_onay_prepared_* path stays for projects
 * without a per-parça snapshot (see the `legacy single-parça` describe
 * block at the bottom).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeApproval, computeBaskiOnayPrepare } from './transitions.js'

const L1 = { id: 'L1', role: 'team_leader', name: 'Ayşenur' }
const L2 = { id: 'L2', role: 'team_leader', name: 'İkinci Lider' }

const ctxWithLeaders = { teamLeaderIds: ['L1', 'L2'] }
const PARCALAR = ['KAPAK', 'KUTU', 'KILAVUZ']

function baskiProject(overrides = {}) {
  return {
    id: 'p-1', type: 'TR', stage: 'baski_onay', progress: 100,
    baski_onay_prepared: false,
    baski_parca_preparers: {},
    baski_parca_approvals: {},
    ...overrides,
  }
}

describe('per-parça baskı onayı dual-leader rule (migration 070)', () => {
  function ctxWithSnapshot() {
    return {
      ...ctxWithLeaders,
      snapshot: { selectedComponents: PARCALAR },
    }
  }

  it('every parça needs both a preparer and a DIFFERENT approver', () => {
    // L1 prepares KAPAK; L2 prepares KUTU; nothing for KILAVUZ yet.
    const p = baskiProject({
      baski_parca_preparers: {
        KAPAK: { by: 'L1', by_name: 'Ayşenur', at: 't1' },
        KUTU: { by: 'L2', by_name: 'İkinci Lider', at: 't2' },
      },
    })
    // L2 approves KAPAK only (different leader from KAPAK preparer L1).
    // KUTU's preparer is L2, so the same leader can't sign it off — L1
    // has to take KUTU instead.
    const r1 = computeApproval(
      p,
      L2,
      { ...ctxWithSnapshot(), parcalar: ['KAPAK'] },
    )
    assert.equal(r1.project.stage, 'baski_onay')
    assert.equal(r1.project.baski_parca_approvals.KAPAK.by, 'L2')
    // L1 approves KUTU (different leader from KUTU preparer L2).
    const r2 = computeApproval(
      r1.project,
      L1,
      { ...ctxWithSnapshot(), parcalar: ['KUTU'] },
    )
    assert.equal(r2.project.stage, 'baski_onay')
    assert.equal(r2.project.baski_parca_approvals.KUTU.by, 'L1')
  })

  it('the maker-checker rule refuses the SAME leader on one parça', () => {
    // L1 prepares KAPAK. If L1 tries to also approve KAPAK, the call
    // fails — another leader must sign off KAPAK.
    const p = baskiProject({
      baski_parca_preparers: {
        KAPAK: { by: 'L1', by_name: 'Ayşenur', at: 't1' },
        KUTU: { by: 'L2', by_name: 'İkinci Lider', at: 't2' },
        KILAVUZ: { by: 'L2', by_name: 'İkinci Lider', at: 't2' },
      },
    })
    assert.throws(
      () => computeApproval(p, L1, ctxWithSnapshot()),
      /hazırlayan kişi kendi onayını veremez: KAPAK/,
    )
  })

  it('the same leader may prepare one parça and approve a different one', () => {
    // L1 prepared KAPAK; L1 may still approve KUTU/KILAVUZ (different
    // preparer). This is the rule the per-parça ledger unlocks.
    const p = baskiProject({
      baski_parca_preparers: {
        KAPAK: { by: 'L1', by_name: 'Ayşenur', at: 't1' },
        KUTU: { by: 'L2', by_name: 'İkinci Lider', at: 't2' },
        KILAVUZ: { by: 'L2', by_name: 'İkinci Lider', at: 't2' },
      },
    })
    // L1 approves only KUTU + KILAVUZ (explicit subset avoids trying to
    // sign KAPAK, which L1 prepared — that would trip the maker-checker).
    const { project: next } = computeApproval(
      p,
      L1,
      { ...ctxWithSnapshot(), parcalar: ['KUTU', 'KILAVUZ'] },
    )
    // KAPAK still pending → stays at baski_onay.
    assert.equal(next.stage, 'baski_onay')
    assert.equal(next.baski_parca_approvals.KUTU.by, 'L1')
    assert.equal(next.baski_parca_approvals.KILAVUZ.by, 'L1')
  })

  it('the bulk shortcut approves every prepared parça at once', () => {
    // All three parçalar have a preparer; the bulk call signs them all
    // off in one click when the approving leader differs from each
    // preparer. L2 has prepared all three → L1 (the only other active
    // leader) does the bulk approve.
    const p = baskiProject({
      baski_parca_preparers: PARCALAR.reduce((acc, parca) => {
        acc[parca] = { by: 'L2', by_name: 'İkinci Lider', at: 't2' }
        return acc
      }, {}),
    })
    const { project: next } = computeApproval(p, L1, ctxWithSnapshot())
    assert.equal(next.stage, 'baskida', 'all approved → advance to Üretimde')
    assert.equal(next.baski_parca_approvals.KAPAK.by, 'L1')
    assert.equal(next.baski_parca_approvals.KUTU.by, 'L1')
    assert.equal(next.baski_parca_approvals.KILAVUZ.by, 'L1')
  })

  it('a partial approve signs off only the chosen parçalar', () => {
    const p = baskiProject({
      baski_parca_preparers: PARCALAR.reduce((acc, parca) => {
        acc[parca] = { by: 'L2', by_name: 'İkinci Lider', at: 't2' }
        return acc
      }, {}),
    })
    // L1 approves only KAPAK + KUTU; KILAVUZ stays pending → baski_onay.
    const { project: next } = computeApproval(
      p,
      L1,
      { ...ctxWithSnapshot(), parcalar: ['KAPAK', 'KUTU'] },
    )
    assert.equal(next.stage, 'baski_onay')
    assert.equal(next.baski_parca_approvals.KAPAK.by, 'L1')
    assert.equal(next.baski_parca_approvals.KUTU.by, 'L1')
    assert.equal(next.baski_parca_approvals.KILAVUZ, undefined)
  })

  it('a parça missing its preparer is NOT pending — preparer is the precondition', () => {
    // KAPAK + KUTU each have a preparer (L1); KILAVUZ doesn't yet. The
    // bulk shortcut signs off KAPAK + KUTU; KILAVUZ stays pending
    // because no preparer = "no one has made the form yet", which is a
    // different bucket from "approver missing". The project stays put.
    const p = baskiProject({
      baski_parca_preparers: {
        KAPAK: { by: 'L1', by_name: 'Ayşenur', at: 't1' },
        KUTU: { by: 'L1', by_name: 'Ayşenur', at: 't1' },
        // KILAVUZ has no preparer yet.
      },
    })
    // L2 (the other leader) bulk-approves the two prepared parçalar.
    const { project: next } = computeApproval(p, L2, ctxWithSnapshot())
    assert.equal(next.stage, 'baski_onay', 'KILAVUZ has no preparer → stay put')
    assert.equal(next.baski_parca_approvals.KAPAK.by, 'L2')
    assert.equal(next.baski_parca_approvals.KUTU.by, 'L2')
    assert.equal(next.baski_parca_approvals.KILAVUZ, undefined)
  })

  it('computeBaskiOnayPrepare records the per-parça preparer', () => {
    const p = baskiProject({ baski_onay_prepared: false })
    const { project: next } = computeBaskiOnayPrepare(p, L1, ctxWithSnapshot())
    assert.equal(next.stage, 'baski_onay')
    // All three parçalar have L1 as preparer (default).
    assert.equal(next.baski_parca_preparers.KAPAK.by, 'L1')
    assert.equal(next.baski_parca_preparers.KUTU.by, 'L1')
    assert.equal(next.baski_parca_preparers.KILAVUZ.by, 'L1')
    assert.equal(next.baski_onay_prepared, true)
  })

  it('computeBaskiOnayPrepare with parcalar subset records only those preparers', () => {
    const p = baskiProject({ baski_onay_prepared: false })
    const { project: next } = computeBaskiOnayPrepare(
      p,
      L1,
      { ...ctxWithSnapshot(), parcalar: ['KAPAK'] },
    )
    assert.equal(next.baski_parca_preparers.KAPAK.by, 'L1')
    assert.equal(next.baski_parca_preparers.KUTU, undefined)
    assert.equal(next.baski_parca_preparers.KILAVUZ, undefined)
  })
})

// Legacy single-parça path (no snapshot): the original dual-leader rule
// at the project level — one leader prepares, a DIFFERENT one approves.
// Per-parça migrations 068/069/070 don't replace this; they only add
// per-parça granularity when a snapshot is available.
describe('legacy baskı onayı (no per-parça snapshot)', () => {
  it('one leader prepares, a DIFFERENT leader approves', () => {
    const p = baskiProject({ baski_onay_prepared: true, baski_onay_prepared_by: 'L1' })
    const { project: next } = computeApproval(p, L2, ctxWithLeaders)
    assert.equal(next.stage, 'baskida')
  })

  it('refuses the same leader on both sides (with another active leader present)', () => {
    const p = baskiProject({ baski_onay_prepared: true, baski_onay_prepared_by: 'L1' })
    assert.throws(
      () => computeApproval(p, L1, ctxWithLeaders),
      /kendi onayını veremez/,
    )
  })
})
