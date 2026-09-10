/**
 * A Baskı Onayı form that WAS prepared, by a project whose per-parça ledger
 * does not say so.
 *
 * Two ways in. Legacy single-parça projects never had a per-parça ledger. And a
 * prepare that ran before the sheet's snapshot existed set the project-level
 * `baski_onay_prepared` scalar while stamping nobody — the dialog called
 * prepare ahead of the save that writes the snapshot, so the FSM had an empty
 * parça list to key on.
 *
 * Reported live, as the second one: the panel read the empty ledger and offered
 * "Baskı Onayı Hazırlayın (3)", the dialog read the scalar and ran approve, and
 * the gate answered "Önce baskı onay formu hazırlanmalıdır: Bilsem, Bilsem
 * KUTU, Bilsem KILAVUZ" — naming three parçalar whose form had been prepared.
 * Re-preparing was not on offer, because the stale scalar is exactly what makes
 * the dialog stop offering it.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeApproval } from './transitions.js'

const alp = { id: 'u-l1', role: 'team_leader', name: 'Ayşenur' }
const bora = { id: 'u-l2', role: 'team_leader', name: 'Serpil' }
const PARCALAR = ['Bilsem', 'Bilsem KUTU', 'Bilsem KILAVUZ']

function preparedByScalarOnly(overrides = {}) {
  return {
    id: 'p-b1', type: 'TR', stage: 'baski_onay', progress: 100,
    // The form was prepared — the scalar says so, and by whom.
    baski_onay_prepared: true,
    baski_onay_prepared_by: alp.id,
    baski_onay_prepared_by_name: alp.name,
    baski_onay_prepared_at: '2026-09-09T09:00:00.000Z',
    // …but no per-parça row survived it.
    baski_parca_preparers: {},
    baski_parca_approvals: {},
    subtasks: [{ id: 's1', kind: 'check', is_done: true }],
    assignees: [],
    ...overrides,
  }
}

const ctx = (extra = {}) => ({
  snapshot: { selectedComponents: PARCALAR },
  teamLeaderIds: [alp.id, bora.id],
  ...extra,
})

describe('baskı onayı — the scalar stands in for a missing per-parça preparer', () => {
  it('no longer refuses the approve as unprepared', () => {
    const result = computeApproval(preparedByScalarOnly(), bora, ctx())
    assert.equal(result.project.stage, 'baskida')
  })

  it('still enforces the maker-checker — the named preparer cannot self-approve', () => {
    assert.throws(
      () => computeApproval(preparedByScalarOnly(), alp, ctx()),
      /hazırlayan kişi kendi onayını veremez/,
    )
  })

  it('lets the sole remaining leader self-approve, as the hatch intends', () => {
    // The other leader is devre dışı, so `teamLeaderIds` names only the
    // preparer — refusing here would strand the project with nobody able to
    // move it.
    const result = computeApproval(
      preparedByScalarOnly(), alp, ctx({ teamLeaderIds: [alp.id] }),
    )
    assert.equal(result.project.stage, 'baskida')
  })

  it('does not invent a preparer when the form was never prepared', () => {
    assert.throws(
      () => computeApproval(
        preparedByScalarOnly({
          baski_onay_prepared: false,
          baski_onay_prepared_by: null,
          baski_onay_prepared_by_name: null,
        }),
        bora,
        ctx(),
      ),
      /Önce baskı onay formu hazırlanmalıdır/,
    )
  })

  it('leaves a real per-parça ledger in charge', () => {
    // Where the ledger HAS a row, it wins — the scalar is only a fallback, and
    // it names whoever prepared last rather than this parça's own preparer.
    const project = preparedByScalarOnly({
      baski_parca_preparers: Object.fromEntries(
        PARCALAR.map((p) => [p, { by: bora.id, by_name: bora.name }]),
      ),
    })
    assert.throws(
      () => computeApproval(project, bora, ctx()),
      /hazırlayan kişi kendi onayını veremez/,
    )
  })
})
