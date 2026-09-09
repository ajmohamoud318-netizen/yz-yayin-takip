/**
 * The per-parça change-request handshake (migration 077).
 *
 * The bug this closes: correcting a sheet the matbaa holds has always had two
 * modes chosen by `projects.demo_started` — free edit while they haven't
 * started, ask/accept/decline once they have. On a round split into parçalar
 * that flag is NEVER set (`startParca` leaves it alone on purpose, so one
 * started parça doesn't hide "İşlemi Başlatın" on the rest), so the free edit
 * stayed open over a parça already on the press and the ask was unreachable.
 *
 * Two halves are pinned here:
 *
 *   • computeDemoEdit / computeOzalitEdit refuse a sheet-wide edit while any
 *     parça of the round is started and unreleased, and name which.
 *   • The edit that IS allowed settles the correction debt an accepted request
 *     left behind, through the third write path (`parcaState`).
 *
 * The patch shapes themselves live in parca-routing.test.js.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  computeDemoEdit, computeOzalitEdit,
  computeDemoCancel, computeOzalitCancel,
} from './transitions.js'

const leader = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }

/** A parça row in whatever state the test needs; defaults to untouched. */
function row(parca, overrides = {}) {
  return {
    parca, gate: 'demo', state: 'with_matbaa', owner_role: 'printer',
    attempt: 1, started_at: null, delivered_at: null, received_at: null,
    change_requested_at: null, fix_pending: false,
    ...overrides,
  }
}

function demoRound(parcaState) {
  return {
    id: 'p-1', type: 'TR', stage: 'demo_teslim',
    demo_attempt: 2, demo_started: false, demo_held: false,
    last_reject_target: null,
    parca_state: parcaState,
  }
}

function ozalitRound(parcaState) {
  return {
    id: 'p-2', type: 'TR', stage: 'ozalit_teslim', progress: 100,
    ozalit_attempt: 1, ozalit_requested: true, ozalit_started: false,
    last_reject_target: null,
    parca_state: parcaState,
  }
}

// `ctx.changedParcalar` is what the prepare hook computes by diffing the sheet
// being saved against the one the matbaa is holding (domain/spec-parca-diff.js).
// `null` means there was no baseline to diff, which the guard treats as "this
// save touches everything".
const touching = (...parcalar) => ({ changedParcalar: parcalar })
const NO_BASELINE = { changedParcalar: null }

describe('computeDemoEdit refuses only the locked parçalar a save rewrites', () => {
  const kutuOnPress = () => demoRound([
    row('KUTU', { state: 'in_round', started_at: '2026-09-01T10:00:00Z' }),
    row('KİTAP'),
  ])

  it('throws when the save rewrites the parça on the press', () => {
    assert.throws(
      () => computeDemoEdit(kutuOnPress(), leader, touching('KUTU')),
      /Matbaa şu parçalara başladı: KUTU/,
    )
  })

  // The regression this scoping exists for: refusing the whole sheet took away
  // the free edit the leader still has on every parça the matbaa has NOT
  // started, which is the point of splitting a round in the first place.
  it('allows a save that only touches the parçalar nobody started', () => {
    const { history } = computeDemoEdit(kutuOnPress(), leader, touching('KİTAP'))
    assert.equal(history.event, 'demo_form_edited')
  })

  it('allows a save that changes no parça block at all', () => {
    // Sheet-level fields only — a new teslim date, a custom row. Nothing the
    // matbaa is producing moves.
    const { history } = computeDemoEdit(kutuOnPress(), leader, touching())
    assert.equal(history.event, 'demo_form_edited')
  })

  it('refuses when it cannot tell what changed', () => {
    // No baseline to diff against: a save that cannot be shown to be safe is
    // not one to wave through on a round already on the press.
    assert.throws(() => computeDemoEdit(kutuOnPress(), leader, NO_BASELINE), /KUTU/)
  })

  it('names every locked parça the save touches, not just the first', () => {
    const project = demoRound([
      row('KUTU', { state: 'in_round', started_at: '2026-09-01T10:00:00Z' }),
      row('KİTAP', { state: 'in_round', started_at: '2026-09-01T11:00:00Z' }),
      row('KILAVUZ'),
    ])
    assert.throws(
      () => computeDemoEdit(project, leader, touching('KUTU', 'KİTAP', 'KILAVUZ')),
      /KUTU, KİTAP/,
    )
  })

  it('allows the edit when no parça has been started', () => {
    const project = demoRound([row('KUTU'), row('KİTAP')])
    const { project: next } = computeDemoEdit(project, leader)
    assert.equal(next.demo_fix_pending, false)
  })

  it('allows the edit with no parça rows at all — rows only exist once acted on', () => {
    const { history } = computeDemoEdit(demoRound([]), leader)
    assert.equal(history.event, 'demo_form_edited')
  })

  it('allows the edit once an accepted request released the parça', () => {
    // What parcaChangeAcceptPatch leaves behind: un-started, back at
    // with_matbaa, carrying the correction debt.
    const project = demoRound([
      row('KUTU', { fix_pending: true }),
      row('KİTAP'),
    ])
    const { history } = computeDemoEdit(project, leader)
    assert.equal(history.event, 'demo_form_edited')
  })

  it('settles the correction debt on exactly the parçalar that owed one', () => {
    const project = demoRound([
      row('KUTU', { fix_pending: true }),
      row('KİTAP'),
    ])
    const { parcaState } = computeDemoEdit(project, leader, touching('KUTU'))
    assert.equal(parcaState.length, 1)
    assert.equal(parcaState[0].parca, 'KUTU')
    assert.equal(parcaState[0].patch.fix_pending, false)
  })

  it('does not settle a debt the save never addressed', () => {
    // Correcting KİTAP does not discharge the correction still owed on KUTU —
    // the matbaa must stay blocked from restarting it.
    const project = demoRound([row('KUTU', { fix_pending: true }), row('KİTAP')])
    const { parcaState } = computeDemoEdit(project, leader, touching('KİTAP'))
    assert.deepEqual(parcaState, [])
  })

  it('writes no parça rows when nothing owed a correction', () => {
    const { parcaState } = computeDemoEdit(demoRound([row('KUTU')]), leader, touching())
    assert.deepEqual(parcaState, [])
  })

  it('keeps the project-level guard ahead of the parça one', () => {
    // A legacy whole-sheet round has no parça rows and must still be refused
    // by the flag it has always been refused by.
    const project = demoRound([])
    project.demo_started = true
    assert.throws(() => computeDemoEdit(project, leader), /değişiklik isteyin/)
  })
})

describe('computeOzalitEdit carries the same per-parça guard', () => {
  it('throws when the save rewrites the parça on the press', () => {
    const project = ozalitRound([
      row('KAPAK', { gate: 'ozalit', state: 'in_round', started_at: '2026-09-01T10:00:00Z' }),
      row('İÇ', { gate: 'ozalit' }),
    ])
    assert.throws(
      () => computeOzalitEdit(project, leader, touching('KAPAK')),
      /Matbaa şu parçalara başladı: KAPAK/,
    )
    // …and lets the leader correct the other one meanwhile.
    const { history } = computeOzalitEdit(project, leader, touching('İÇ'))
    assert.equal(history.event, 'ozalit_form_edited')
  })

  it('settles the correction debt on the released parça', () => {
    const project = ozalitRound([
      row('KAPAK', { gate: 'ozalit', fix_pending: true }),
    ])
    const { parcaState } = computeOzalitEdit(project, leader, touching('KAPAK'))
    assert.deepEqual(parcaState.map((p) => p.parca), ['KAPAK'])
  })
})

/**
 * The round's parça LIST, as opposed to what its parçalar say.
 *
 * There has always been a guard for this — the "parça-list pin" in
 * routes/demos.js — and it missed the edit-and-notify path twice over: it only
 * fires at the *_onay stages, and it lives on POST /demos while edit-notify
 * writes its snapshot straight from `withDemoSnapshot`. So a leader could untick
 * a parça in the sheet's picker on a live *_teslim round and the round quietly
 * became a different round — with `pruneApprovalsToSnapshot` then deleting the
 * dropped parça's approvals, which is the exact destruction the pin exists for.
 */
describe('edit refuses a save that changes which parçalar the round carries', () => {
  const setDelta = (added, removed) => ({
    changedParcalar: [...added, ...removed],
    parcaSetDelta: { added, removed },
  })

  it('refuses to take a parça off a live round', () => {
    assert.throws(
      () => computeDemoEdit(demoRound([row('KUTU')]), leader, setDelta([], ['KİTAP'])),
      /turdan parça çıkarılamaz: KİTAP/,
    )
  })

  it('refuses to put a new parça on one', () => {
    assert.throws(
      () => computeDemoEdit(demoRound([row('KUTU')]), leader, setDelta(['KILAVUZ'], [])),
      /tura yeni parça eklenemez: KILAVUZ/,
    )
  })

  it('names every parça involved, not just the first', () => {
    assert.throws(
      () => computeDemoEdit(demoRound([]), leader, setDelta([], ['KİTAP', 'KILAVUZ'])),
      /KİTAP, KILAVUZ/,
    )
  })

  it('reports the removal ahead of the addition — they are separate mistakes', () => {
    // Both at once is a re-composed round. Removing is the destructive half, so
    // that is the message the leader gets.
    assert.throws(
      () => computeDemoEdit(demoRound([]), leader, setDelta(['KILAVUZ'], ['KİTAP'])),
      /çıkarılamaz/,
    )
  })

  it('asks membership before content, so the message names the real problem', () => {
    // The parça being dropped is also on the press. Both guards would fire;
    // "you cannot remove a parça" is the one that explains what happened.
    const project = demoRound([
      row('KUTU', { state: 'in_round', started_at: '2026-09-01T10:00:00Z' }),
    ])
    assert.throws(
      () => computeDemoEdit(project, leader, setDelta([], ['KUTU'])),
      /çıkarılamaz/,
    )
  })

  it('lets an ordinary same-set edit through', () => {
    const { history } = computeDemoEdit(
      demoRound([row('KUTU'), row('KİTAP')]), leader,
      { changedParcalar: ['KİTAP'], parcaSetDelta: { added: [], removed: [] } },
    )
    assert.equal(history.event, 'demo_form_edited')
  })

  it('does not judge a round that never had a parça list', () => {
    // `parcaSetDelta` returns null there — see its own tests. Refusing would
    // block a legitimate edit on a legacy round, and the lock guard above still
    // protects anything actually on the press.
    const { history } = computeDemoEdit(
      demoRound([row('KUTU')]), leader,
      { changedParcalar: ['KUTU'], parcaSetDelta: null },
    )
    assert.equal(history.event, 'demo_form_edited')
  })

  it('guards the ozalit leg identically', () => {
    const project = ozalitRound([row('KAPAK', { gate: 'ozalit' })])
    assert.throws(
      () => computeOzalitEdit(project, leader, setDelta([], ['İÇ'])),
      /turdan parça çıkarılamaz: İÇ/,
    )
    assert.throws(
      () => computeOzalitEdit(project, leader, setDelta(['SIRT'], [])),
      /tura yeni parça eklenemez: SIRT/,
    )
  })
})

/**
 * "Kalan Parçaları Gönderin" — the sanctioned way to put parçalar the round was
 * never sent in front of the matbaa.
 *
 * It goes THROUGH the membership guard above rather than around it, which is
 * the whole design: the flag relaxes exactly one half, so every other way of
 * changing the round's parça list stays shut.
 */
describe('edit accepts a sanctioned parça add', () => {
  const adding = (...added) => ({
    changedParcalar: added,
    parcaSetDelta: { added, removed: [] },
    allowParcaAdd: true,
  })

  it('lets the flag put a new parça on the round', () => {
    const { history } = computeDemoEdit(demoRound([row('KUTU')]), leader, adding('KİTAP'))
    assert.equal(history.event, 'demo_form_edited')
  })

  it('still refuses a removal riding along with it', () => {
    // The case a single "the list may change" flag would have waved through.
    // Adding and withdrawing are different acts and only one of them is asked
    // for here, so unticking KILAVUZ while ticking KİTAP is still a no.
    assert.throws(
      () => computeDemoEdit(demoRound([row('KUTU')]), leader, {
        changedParcalar: ['KİTAP', 'KILAVUZ'],
        parcaSetDelta: { added: ['KİTAP'], removed: ['KILAVUZ'] },
        allowParcaAdd: true,
      }),
      /çıkarılamaz: KILAVUZ/,
    )
  })

  it('refuses a parça this project has already routed', () => {
    // Absent from the round is not the same as never sent. A parça out with the
    // designer, or already approved, has a routing row — handing it to the
    // matbaa as fresh work would jump the designer's queue or reopen a decision.
    const project = demoRound([
      row('KUTU'),
      row('KİTAP', { state: 'with_designer', owner_role: 'designer' }),
    ])
    assert.throws(
      () => computeDemoEdit(project, leader, adding('KİTAP')),
      /zaten işlem gördü: KİTAP/,
    )
  })

  it('allows the add while another parça is on the press', () => {
    // The point of the feature: the matbaa prints KUTU while the leader sends
    // KİTAP. Only the added parça changed, so the press is untouched.
    const project = demoRound([
      row('KUTU', { state: 'in_round', started_at: '2026-09-01T10:00:00Z' }),
    ])
    const { history } = computeDemoEdit(project, leader, adding('KİTAP'))
    assert.equal(history.event, 'demo_form_edited')
  })

  it('says on the timeline that a parça was added, not that a form changed', () => {
    const { history } = computeDemoEdit(demoRound([]), leader, adding('KİTAP', 'KILAVUZ'))
    assert.match(history.note, /Tura parça eklendi: KİTAP, KILAVUZ/)
  })

  it('leaves an ordinary correction’s note alone', () => {
    const { history } = computeDemoEdit(demoRound([row('KUTU')]), leader, {
      changedParcalar: ['KUTU'], parcaSetDelta: { added: [], removed: [] },
    })
    assert.equal(history.note, 'Demo formu güncellendi')
  })

  it('refuses the add without the flag, however the save is shaped', () => {
    assert.throws(
      () => computeDemoEdit(demoRound([]), leader, {
        changedParcalar: ['KİTAP'],
        parcaSetDelta: { added: ['KİTAP'], removed: [] },
      }),
      /yeni parça eklenemez/,
    )
  })

  it('carries the whole thing on the ozalit leg', () => {
    const project = ozalitRound([row('KAPAK', { gate: 'ozalit' })])
    const { history } = computeOzalitEdit(project, leader, adding('SIRT'))
    assert.match(history.note, /Tura parça eklendi: SIRT/)
    assert.throws(
      () => computeOzalitEdit(project, leader, {
        changedParcalar: ['SIRT'],
        parcaSetDelta: { added: ['SIRT'], removed: ['KAPAK'] },
        allowParcaAdd: true,
      }),
      /çıkarılamaz: KAPAK/,
    )
  })
})

describe('cancel carries the same per-parça guard as edit', () => {
  // The more destructive twin: cancel sends the project back to tasarim, so
  // withdrawing a round the matbaa is half way through printing is worse than
  // silently editing it — and it had the identical dead `demo_started` guard.
  it('refuses to withdraw a round with a parça on the press', () => {
    const project = demoRound([
      row('KUTU', { state: 'in_round', started_at: '2026-09-01T10:00:00Z' }),
      row('KİTAP'),
    ])
    assert.throws(
      () => computeDemoCancel(project, leader),
      /Matbaa şu parçalara başladı: KUTU/,
    )
  })

  it('still allows the cancel while the matbaa has started nothing', () => {
    const { project: next } = computeDemoCancel(demoRound([row('KUTU'), row('KİTAP')]), leader)
    assert.equal(next.stage, 'tasarim')
  })

  it('allows it once an accepted request released the parça', () => {
    const { project: next } = computeDemoCancel(demoRound([row('KUTU', { fix_pending: true })]), leader)
    assert.equal(next.stage, 'tasarim')
  })

  it('ozalit cancel refuses the same way', () => {
    const project = ozalitRound([
      row('KAPAK', { gate: 'ozalit', state: 'in_round', started_at: '2026-09-01T10:00:00Z' }),
    ])
    assert.throws(() => computeOzalitCancel(project, leader), /Matbaa şu parçalara başladı: KAPAK/)
  })
})
