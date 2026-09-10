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

import { computeApproval, computeBaskiOnayPrepare, computeRejection } from './transitions.js'

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

/**
 * The lone-leader escape hatch (migration 070).
 *
 * Baskı onayı is maker-checker: one leader prepares, a DIFFERENT one approves.
 * With nobody else active that rule has no one left to satisfy, so the preparer
 * may sign their own — otherwise the project is stuck at baskı onayı with no
 * one able to move it.
 *
 * Both halves of the hatch are pinned here, because it used to only half-work:
 * the check that ALLOWS the self-approval was computed against the
 * project-level `baski_onay_prepared_by` scalar (overwritten by whoever
 * prepared last, so it named the wrong person on a multi-preparer round), and
 * the advance gate separately treated "same person on both sides" as unfinished
 * — so even a permitted self-approval never completed the round.
 */
describe('baskı onayı with only one active team leader', () => {
  const soloCtx = (parcalar = PARCALAR) => ({
    teamLeaderIds: ['L1'],
    snapshot: { selectedComponents: parcalar },
  })

  it('lets the only leader approve the parça they prepared', () => {
    const p = baskiProject({
      baski_parca_preparers: { KAPAK: { by: 'L1', by_name: 'Ayşenur', at: 't1' } },
    })
    assert.doesNotThrow(() => computeApproval(p, L1, { ...soloCtx(['KAPAK']), parcalar: ['KAPAK'] }))
  })

  it('and that self-approval actually completes the round', () => {
    // The half that was missing: allowed to approve, but the parça stayed
    // "pending" forever because approver === preparer.
    const p = baskiProject({
      baski_parca_preparers: { KAPAK: { by: 'L1', by_name: 'Ayşenur', at: 't1' } },
    })
    const { project: next } = computeApproval(
      p, L1, { ...soloCtx(['KAPAK']), parcalar: ['KAPAK'] },
    )
    assert.equal(next.stage, 'baskida', 'the project must move on')
  })

  it('still refuses a self-approval while another leader is active', () => {
    const p = baskiProject({
      baski_parca_preparers: { KAPAK: { by: 'L1', by_name: 'Ayşenur', at: 't1' } },
    })
    assert.throws(
      () => computeApproval(
        p, L1,
        { teamLeaderIds: ['L1', 'L2'], snapshot: { selectedComponents: ['KAPAK'] }, parcalar: ['KAPAK'] },
      ),
      /kendi onayını veremez/,
    )
  })

  it('survives leader churn on a multi-preparer round', () => {
    // The exact deadlock: L1 prepared KAPAK, L2 prepared KUTU (so the
    // project-level scalar names L2), then L2 was deactivated. L1 is now the
    // only active leader and must be able to close BOTH parçalar — including
    // the one they prepared themselves.
    const p = baskiProject({
      baski_onay_prepared_by: 'L2', // scalar names the LAST preparer, not KAPAK's
      baski_parca_preparers: {
        KAPAK: { by: 'L1', by_name: 'Ayşenur', at: 't1' },
        KUTU: { by: 'L2', by_name: 'İkinci Lider', at: 't2' },
      },
    })
    assert.doesNotThrow(
      () => computeApproval(p, L1, { ...soloCtx(['KAPAK', 'KUTU']), parcalar: ['KAPAK', 'KUTU'] }),
      'the only active leader must not be locked out of their own parça',
    )
    const { project: next } = computeApproval(
      p, L1, { ...soloCtx(['KAPAK', 'KUTU']), parcalar: ['KAPAK', 'KUTU'] },
    )
    assert.equal(next.stage, 'baskida')
  })
})

/**
 * Regression: a rejected baskı onayı round must not leave its maker-checker
 * ledger behind. Nothing cleared it on reject — only computeApproval ever
 * wrote these columns, and only on a completing/partial APPROVE. A reject
 * bounces the project to tasarım for a full redesign, but the OLD
 * preparer/approval pair stayed keyed under the same parça names. Since a
 * reprint of the same title reuses those names, the next baski_onay round
 * could read a stale approval — signed on a sheet that was rejected and
 * never printed — as already maker-checked, and reach production unsigned.
 */
describe('a rejected baskı onayı round clears its maker-checker ledger', () => {
  it('on reject-to-designer', () => {
    const p = baskiProject({
      baski_onay_prepared: true,
      baski_onay_prepared_by: 'L1',
      baski_onay_prepared_by_name: 'Ayşenur',
      baski_onay_prepared_at: 't0',
      baski_parca_preparers: { KAPAK: { by: 'L1', by_name: 'Ayşenur', at: 't1' } },
      baski_parca_approvals: { KAPAK: { by: 'L2', by_name: 'İkinci Lider', at: 't2' } },
    })
    const { project: next } = computeRejection(
      p, 'Renkler yanlış', [], 'designer', { actorName: 'Ayşenur', actor: L1 },
    )
    assert.equal(next.stage, 'tasarim')
    assert.equal(next.baski_onay_prepared, false)
    assert.equal(next.baski_onay_prepared_by, null)
    assert.deepEqual(next.baski_parca_preparers, {})
    assert.deepEqual(next.baski_parca_approvals, {})
  })

  it('on reject-to-matbaa too — the reprint is the same design, but the sign-off is not', () => {
    const p = baskiProject({
      stage: 'cin_baski_onay',
      cin_baski_parca_preparers: { KAPAK: { by: 'L1', by_name: 'Ayşenur', at: 't1' } },
      cin_baski_parca_approvals: { KAPAK: { by: 'L2', by_name: 'İkinci Lider', at: 't2' } },
    })
    const { project: next } = computeRejection(
      p, 'Baskı hatalı', [], 'matbaa', { actorName: 'Ayşenur', actor: L1 },
    )
    assert.deepEqual(next.cin_baski_parca_preparers, {})
    assert.deepEqual(next.cin_baski_parca_approvals, {})
  })

  it('does not touch the ledger on a per-parça reject — the rest of the round is still live', () => {
    const p = baskiProject({
      baski_parca_preparers: {
        KAPAK: { by: 'L1', by_name: 'Ayşenur', at: 't1' },
        KUTU: { by: 'L1', by_name: 'Ayşenur', at: 't1' },
      },
      baski_parca_approvals: { KUTU: { by: 'L2', by_name: 'İkinci Lider', at: 't2' } },
    })
    // Baskı Onayı has no designer/matbaa leg to send a parça back to — a
    // per-parça reject here would be refused server-side either way
    // (computeRejection's "yalnızca demo ve ozalit" guard) — this only pins
    // that the WHOLE-round reset stays scoped to a whole-round reject.
    assert.throws(
      () => computeRejection(p, 'x', [], 'designer', { actorName: 'Ayşenur', actor: L1, parcalar: ['KUTU'] }),
      /Parça bazlı red yalnızca demo ve ozalit/,
    )
  })
})
