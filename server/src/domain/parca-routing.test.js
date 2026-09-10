/**
 * Per-parça routing lifecycle (migration 074).
 *
 * The feature these pin down: a leader can reject KUTU to the matbaa and KİTAP
 * to the designer on the SAME project, and both parties work independently
 * while the already-approved parçalar stay signed off.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  parcaGateForStage,
  parcaRejectPatch,
  parcaRequestRoundPatch,
  parcaStartPatch,
  parcaDeliverPatch,
  parcaEditLocked,
  parcaChangeRequestable,
  lockedParcaNames,
  parcaChangeRequestPatch,
  parcaChangeAcceptPatch,
  parcaChangeDeclinePatch,
  parcaFixSettledPatch,
  parcaAlreadyDelivered,
  parcaReceivePatch,
  parcalarOwnedBy,
  canActOnParca,
  parcaFixSettlements,
  parcaNotReceivedPatch,
} from './parca-routing.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }
const NOW = '2026-09-07T10:00:00.000Z'

describe('parcaFixSettlements', () => {
  const owing = (parca) => ({ parca, fix_pending: true, owner_role: 'printer', route: 'physical', started_at: null })

  it('settles only the parçalar the save touched', () => {
    const out = parcaFixSettlements(
      [owing('KUTU'), owing('KİTAP'), { parca: 'KILAVUZ', fix_pending: false }], ['kutu'],
    )
    assert.deepEqual(out.map((s) => s.parca), ['KUTU'])
    assert.equal(out[0].patch.fix_pending, false)
    assert.equal(out[0].patch.owner_role, 'printer', 'the owner survives the verbatim upsert')
  })

  it('treats a save with no baseline as covering the whole sheet', () => {
    assert.deepEqual(
      parcaFixSettlements([owing('KUTU'), owing('KİTAP')], null).map((s) => s.parca),
      ['KUTU', 'KİTAP'],
    )
  })
})

describe('parcaNotReceivedPatch', () => {
  it("puts a delivered parça back on the matbaa's desk, still started", () => {
    const patch = parcaNotReceivedPatch({ now: NOW })
    assert.equal(patch.state, 'in_round')
    assert.equal(patch.started_at, NOW)
    assert.equal(patch.delivered_at, null)
    assert.ok(canActOnParca({ role: 'printer' }, patch), 'and it is theirs to deliver again')
  })
})

describe('parcaGateForStage', () => {
  it('maps both demo onay stages to the demo gate', () => {
    assert.equal(parcaGateForStage('demo_onay'), 'demo')
    assert.equal(parcaGateForStage('cin_demo_onay'), 'demo')
  })

  it('maps ozalit onay to the ozalit gate', () => {
    assert.equal(parcaGateForStage('ozalit_onay'), 'ozalit')
  })

  it('has no gate for baskı onayı — leader-to-leader, nobody to route to', () => {
    assert.equal(parcaGateForStage('baski_onay'), null)
    assert.equal(parcaGateForStage('cin_baski_onay'), null)
  })

  it('has no gate anywhere else', () => {
    assert.equal(parcaGateForStage('tasarim'), null)
    assert.equal(parcaGateForStage(undefined), null)
  })
})

describe('rejecting a parça routes it to the named party', () => {
  it('to the designer', () => {
    const patch = parcaRejectPatch({
      target: 'designer', reason: 'kerning hatalı', actor: leader,
      actorName: leader.name, now: NOW, gate: 'ozalit', currentAttempt: 1,
    })
    assert.equal(patch.state, 'with_designer')
    assert.equal(patch.owner_role, 'designer')
    assert.equal(patch.reason, 'kerning hatalı')
    assert.equal(patch.rejected_by, 'u-l')
    assert.equal(patch.attempt, 2)
  })

  it('to the matbaa', () => {
    const patch = parcaRejectPatch({
      target: 'matbaa', reason: 'baskı lekeli', actor: leader,
      actorName: leader.name, now: NOW, gate: 'demo', currentAttempt: 3,
    })
    assert.equal(patch.state, 'with_matbaa')
    assert.equal(patch.owner_role, 'printer')
    assert.equal(patch.attempt, 4)
  })

  it('clears the round flags so the matbaa’s Başlatın button reappears', () => {
    // The project-level legReset exists for exactly this reason: a stale
    // started flag hides "İşlemi Başlatın" for a round that hasn't begun.
    const patch = parcaRejectPatch({
      target: 'matbaa', reason: 'x', actor: leader, actorName: 'A',
      now: NOW, gate: 'demo', currentAttempt: 1,
    })
    assert.equal(patch.started_at, null)
    assert.equal(patch.delivered_at, null)
  })

  it('never presumes the route — that is the designer’s choice', () => {
    for (const target of ['designer', 'matbaa']) {
      const patch = parcaRejectPatch({
        target, reason: 'x', actor: leader, actorName: 'A',
        now: NOW, gate: 'demo', currentAttempt: 1,
      })
      assert.equal(patch.route, null)
    }
  })
})

describe('the designer sends a revized parça back round', () => {
  it('a physical round puts it on the matbaa’s desk, not yet started', () => {
    const patch = parcaRequestRoundPatch({ route: 'physical', now: NOW })
    assert.equal(patch.state, 'with_matbaa')
    assert.equal(patch.owner_role, 'printer')
    assert.equal(patch.route, 'physical')
    assert.equal(patch.started_at, null)
    assert.equal(patch.delivered_at, null, 'a requested round has not been delivered')
  })

  it('an ekran round skips the matbaa entirely', () => {
    const patch = parcaRequestRoundPatch({ route: 'ekran', now: NOW })
    assert.equal(patch.state, 'pending')
    assert.equal(patch.owner_role, null, 'nobody holds it — it is the leader’s call')
    assert.equal(patch.route, 'ekran')
  })

  it('refuses a route it does not know', () => {
    assert.throws(() => parcaRequestRoundPatch({ route: 'ozalit', now: NOW }), /Geçersiz parça rotası/)
    assert.throws(() => parcaRequestRoundPatch({ route: null, now: NOW }), /Geçersiz parça rotası/)
  })
})

describe('the matbaa works one parça', () => {
  it('başlatın stamps started_at without moving anything else', () => {
    const patch = parcaStartPatch({ now: NOW })
    assert.equal(patch.state, 'in_round')
    assert.equal(patch.started_at, NOW)
    assert.equal(patch.owner_role, 'printer', 'still theirs until they deliver')
  })

  it('teslim hands it back to the gate with no owner', () => {
    const patch = parcaDeliverPatch({ now: NOW })
    assert.equal(patch.state, 'pending')
    assert.equal(patch.owner_role, null)
    assert.equal(patch.delivered_at, NOW)
  })
})

describe('the change-request handshake (migration 077)', () => {
  const started = (over = {}) => ({
    parca: 'KUTU', state: 'in_round', owner_role: 'printer',
    started_at: NOW, fix_pending: false, change_requested_at: null, ...over,
  })

  it('a parça the matbaa has started is locked against a silent edit', () => {
    assert.equal(parcaEditLocked(started()), true)
  })

  it('an unstarted parça is not locked', () => {
    assert.equal(parcaEditLocked(started({ state: 'with_matbaa', started_at: null })), false)
  })

  it('a missing row is not locked — rows exist only once someone acts', () => {
    assert.equal(parcaEditLocked(null), false)
    assert.equal(parcaEditLocked(undefined), false)
  })

  it('an accepted request unlocks it — that is what accepting is for', () => {
    assert.equal(parcaEditLocked(started({ started_at: null, fix_pending: true })), false)
  })

  it('only a locked parça with no pending ask may be asked about', () => {
    assert.equal(parcaChangeRequestable(started()), true)
    assert.equal(parcaChangeRequestable(started({ change_requested_at: NOW })), false, 'no stacking')
    assert.equal(parcaChangeRequestable(started({ started_at: null })), false, 'nothing to ask')
  })

  it('lockedParcaNames names exactly the parçalar an edit would rewrite', () => {
    assert.deepEqual(lockedParcaNames([
      started({ parca: 'KUTU' }),
      started({ parca: 'KİTAP', started_at: null }),
      started({ parca: 'KILAVUZ', started_at: null, fix_pending: true }),
    ]), ['KUTU'])
    assert.deepEqual(lockedParcaNames([]), [])
    assert.deepEqual(lockedParcaNames(null), [])
  })

  it('the ask leaves the parça exactly where it is', () => {
    const patch = parcaChangeRequestPatch({
      note: '  kapak rengi yanlış  ', actor: leader, actorName: leader.name,
      now: NOW, startedAt: NOW,
    })
    assert.equal(patch.change_requested_at, NOW)
    assert.equal(patch.change_requested_by_name, leader.name)
    assert.equal(patch.change_requested_note, 'kapak rengi yanlış', 'trimmed')
    // Restated, not dropped: upsertParcaState writes this stamp verbatim, and
    // clearing it would tell the matbaa's queue they never started.
    assert.equal(patch.started_at, NOW)
    assert.equal(patch.state, undefined, 'the parça does not move')
  })

  // Regression, found end-to-end and invisible to a patch-shape test alone:
  // upsertParcaState writes owner_role and route VERBATIM so a parça returning
  // to the gate can clear them. Both patches below leave the parça WITH the
  // matbaa, so omitting the pair handed the row to nobody — it dropped out of
  // listParcaStateByOwner('printer'), deriveTeslimParcalar rebuilt a synthetic
  // card from the round's snapshot with no change-request fields, and the
  // matbaa was shown an ordinary "Teslim Edin" instead of the question.
  it('every patch that leaves the parça with the matbaa restates the owner', () => {
    for (const [label, patch] of [
      ['request', parcaChangeRequestPatch({ note: 'x', actor: leader, now: NOW, startedAt: NOW })],
      ['decline', parcaChangeDeclinePatch({ startedAt: NOW })],
      ['accept', parcaChangeAcceptPatch()],
      ['start', parcaStartPatch({ now: NOW })],
    ]) {
      assert.equal(patch.owner_role, 'printer', `${label} must keep the parça with the matbaa`)
      assert.equal(patch.route, 'physical', `${label} must keep the route`)
    }
  })

  it('and every patch that hands it back clears the owner', () => {
    assert.equal(parcaDeliverPatch({ now: NOW }).owner_role, null)
  })

  // The structural guard for the whole bug class, rather than one more case.
  //
  // `upsertParcaState` writes owner_role and route VERBATIM so a parça
  // returning to the gate can clear them, which makes OMITTING the pair mean
  // "give this parça to nobody" — a state no actor can act on and no
  // transition can leave (migration 078 had to repair the rows by hand). The
  // omission is silent at every layer: the patch is valid, the upsert
  // succeeds, and the damage only surfaces as "Bu parça sizde değil" on a
  // screen far away. So every patch must SAY what it means, even when it
  // means null.
  it('no patch may leave the owner unstated', () => {
    const patches = {
      reject: parcaRejectPatch({
        target: 'matbaa', reason: 'x', actor: leader, actorName: leader.name,
        now: NOW, gate: 'demo', currentAttempt: 1,
      }),
      requestRound: parcaRequestRoundPatch({ route: 'physical', now: NOW }),
      requestRoundEkran: parcaRequestRoundPatch({ route: 'ekran', now: NOW }),
      start: parcaStartPatch({ now: NOW }),
      deliver: parcaDeliverPatch({ now: NOW }),
      receive: parcaReceivePatch({ actor: leader, actorName: leader.name, now: NOW }),
      changeRequest: parcaChangeRequestPatch({ note: 'x', actor: leader, now: NOW, startedAt: NOW }),
      changeAccept: parcaChangeAcceptPatch(),
      changeDecline: parcaChangeDeclinePatch({ startedAt: NOW }),
      fixSettled: parcaFixSettledPatch({ owner_role: 'printer', route: 'physical' }),
    }
    for (const [name, patch] of Object.entries(patches)) {
      assert.ok('owner_role' in patch, `${name} must state owner_role explicitly`)
      assert.ok('route' in patch, `${name} must state route explicitly`)
    }
  })

  it('an empty note is stored as null, not as an empty string', () => {
    const patch = parcaChangeRequestPatch({ note: '   ', actor: leader, now: NOW })
    assert.equal(patch.change_requested_note, null)
  })

  it('accepting un-starts the parça and leaves the correction debt', () => {
    const patch = parcaChangeAcceptPatch()
    assert.equal(patch.state, 'with_matbaa', 'back to where it was before Başlatın')
    assert.equal(patch.started_at, null)
    assert.equal(patch.fix_pending, true, 'blocks a re-start until the fix lands')
    assert.equal(patch.change_requested_at, null, 'the question is answered')
    assert.equal(patch.owner_role, 'printer', 'still the matbaa’s job, just paused')
  })

  it('declining clears only the question', () => {
    const patch = parcaChangeDeclinePatch({ startedAt: NOW })
    assert.equal(patch.change_requested_at, null)
    assert.equal(patch.started_at, NOW, 'they keep working')
    assert.equal(patch.state, undefined, 'the parça does not move')
    assert.equal(patch.fix_pending, undefined, 'no debt was created')
  })

  it('the correction landing clears the debt without erasing the round', () => {
    // The shape parcaChangeAcceptPatch leaves behind: still the matbaa's,
    // un-started, owing the fix.
    const row = {
      parca: 'KUTU', state: 'with_matbaa', owner_role: 'printer', route: 'physical',
      started_at: null, delivered_at: null, received_at: null, fix_pending: true,
    }
    const patch = parcaFixSettledPatch(row)
    assert.equal(patch.fix_pending, false)
    // The stamps are restated because the repository writes them verbatim —
    // a bare flag-clear would wipe the round it is settling.
    assert.ok('started_at' in patch && 'delivered_at' in patch && 'received_at' in patch)
    // …and so is the owner, or the matbaa's next "İşlemi Başlatın" is refused
    // with "Bu parça sizde değil" on a parça that is plainly theirs.
    assert.equal(patch.owner_role, 'printer')
    assert.equal(patch.route, 'physical')
  })

  it('every leg that ends a round drops a stale correction debt', () => {
    assert.equal(parcaRejectPatch({
      target: 'designer', reason: 'x', actor: leader, actorName: leader.name,
      now: NOW, gate: 'demo', currentAttempt: 1,
    }).fix_pending, false)
    assert.equal(parcaRequestRoundPatch({ route: 'physical', now: NOW }).fix_pending, false)
    assert.equal(parcaRequestRoundPatch({ route: 'ekran', now: NOW }).fix_pending, false)
  })

  it('ask → accept → fix → start: the matbaa can pick it up again', () => {
    let row = started()
    row = { ...row, ...parcaChangeRequestPatch({ note: 'düzeltin', actor: leader, now: NOW, startedAt: row.started_at }) }
    assert.equal(parcaChangeRequestable(row), false, 'no second ask while one is open')

    row = { ...row, ...parcaChangeAcceptPatch() }
    assert.equal(parcaEditLocked(row), false, 'the leader may edit now')

    row = { ...row, ...parcaFixSettledPatch(row) }
    assert.equal(row.fix_pending, false)

    row = { ...row, ...parcaStartPatch({ now: NOW }) }
    assert.equal(row.state, 'in_round', 'and the matbaa is back on it')
  })

  it('ask → decline: the parça never leaves the press', () => {
    let row = started()
    row = { ...row, ...parcaChangeRequestPatch({ note: 'düzeltin', actor: leader, now: NOW, startedAt: row.started_at }) }
    row = { ...row, ...parcaChangeDeclinePatch({ startedAt: row.started_at }) }
    assert.equal(row.state, 'in_round')
    assert.equal(parcaEditLocked(row), true, 'still locked — the leader waits for delivery')
    assert.equal(parcaChangeRequestable(row), true, 'but they may ask again')
  })
})

describe('two parties on one project at the same time', () => {
  // The core promise of the feature.
  const rows = [
    { parca: 'KUTU', state: 'approved', owner_role: null },
    { parca: 'KİTAP', state: 'with_designer', owner_role: 'designer' },
    { parca: 'KILAVUZ', state: 'in_round', owner_role: 'printer' },
  ]

  it('each role sees only their own parçalar', () => {
    assert.deepEqual(parcalarOwnedBy(rows, 'designer'), ['KİTAP'])
    assert.deepEqual(parcalarOwnedBy(rows, 'printer'), ['KILAVUZ'])
  })

  it('the approved parça belongs to nobody and stays signed off', () => {
    assert.deepEqual(parcalarOwnedBy(rows, 'team_leader'), [])
    assert.equal(rows[0].state, 'approved')
  })

  it('neither party can act on the other’s parça', () => {
    const designer = { id: 'u-d', role: 'designer' }
    const printer = { id: 'u-p', role: 'printer' }
    const kitap = rows[1]
    const kilavuz = rows[2]
    assert.equal(canActOnParca(designer, kitap), true)
    assert.equal(canActOnParca(designer, kilavuz), false)
    assert.equal(canActOnParca(printer, kilavuz), true)
    assert.equal(canActOnParca(printer, kitap), false)
  })

  it('nobody can act on an approved parça', () => {
    for (const role of ['designer', 'printer', 'team_leader']) {
      assert.equal(canActOnParca({ role }, rows[0]), false)
    }
  })

  it('the matbaa may act both before and after starting', () => {
    const printer = { role: 'printer' }
    assert.equal(canActOnParca(printer, { owner_role: 'printer', state: 'with_matbaa' }), true)
    assert.equal(canActOnParca(printer, { owner_role: 'printer', state: 'in_round' }), true)
  })
})

describe('delivering the same parça twice', () => {
  // Reported from the field as a 400 on "Teslim Edin": delivering clears
  // owner_role (the parça is at the gate now), so the second arrival of one
  // click read as "Bu parça sizde değil." about a parça the printer had just
  // handed over. Two taps on a phone, or one tap against a stale queue.
  it('recognises a parça that already came back this round', () => {
    assert.equal(parcaAlreadyDelivered({ state: 'pending', delivered_at: NOW }), true)
  })

  it('does not short-circuit a parça that is out on a NEW round', () => {
    // A reject clears delivered_at precisely so the next round can be
    // delivered again — short-circuiting here would strand it forever.
    assert.equal(parcaAlreadyDelivered({ state: 'with_matbaa', delivered_at: null }), false)
    assert.equal(parcaAlreadyDelivered({ state: 'in_round', delivered_at: null }), false)
  })

  it('still counts as delivered once the leader has taken receipt', () => {
    assert.equal(
      parcaAlreadyDelivered({ state: 'pending', delivered_at: NOW, received_at: NOW }),
      true,
    )
  })

  it('is false for a parça standing at the gate that never arrived', () => {
    // An ekran round has no physical proof — nothing was delivered.
    assert.equal(parcaAlreadyDelivered({ state: 'pending', delivered_at: null }), false)
    assert.equal(parcaAlreadyDelivered(null), false)
  })
})
