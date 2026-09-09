/**
 * The leader's per-parça correction path (migration 077) — client gates.
 *
 * The bug: "Gönderilen Demoyu Düzenleyin" is gated on `project.demo_started`,
 * and a split round never sets it. `startParca` leaves that flag alone on
 * purpose — setting it because ONE parça started would hide "İşlemi Başlatın"
 * on every parça the matbaa still owes — so the leader kept being offered a
 * silent whole-sheet rewrite over a parça already on the press, while
 * "Değişiklik İste" (which needs the flag TRUE) never appeared at all.
 *
 * These pin the gates that decide which surface the leader gets. The server
 * refuses the same edit at write time — see
 * server/src/domain/transitions.parca-change-request.test.js — so a stale
 * client cannot get past this either.
 */

import { describe, it, expect } from 'vitest'

import {
  canEditSentDemoRequest,
  canEditSentOzalitRequest,
  canCancelDemoRequest,
  canCancelOzalitRequest,
  parcaEditLocked,
  parcaChangeRequestable,
  lockedParcaNames,
  parcalarAwaitingFix,
  unsentParcalar,
} from './pipeline.js'

const AYSE = { id: 'u-l', role: 'team_leader', name: 'Ayşenur' }
const OKTAY = { id: 'u-p', role: 'printer', name: 'Oktay' }

const demoRound = { stage: 'demo_teslim', demo_started: false }
const ozalitRound = { stage: 'ozalit_teslim', ozalit_requested: true, ozalit_started: false }

/** A parça row the matbaa holds; defaults to one they have not started. */
function row(parca, over = {}) {
  return {
    parca, state: 'with_matbaa', owner_role: 'printer',
    started_at: null, fix_pending: false, change_requested_at: null, ...over,
  }
}

const onPress = (parca) => row(parca, { state: 'in_round', started_at: '2026-09-01T10:00:00Z' })

/**
 * What "Kalan Parçaları Gönderin" is allowed to offer.
 *
 * The tempting definition — catalog minus the round — is wrong, and wrong in a
 * way that hands the matbaa work belonging to somebody else. These pin the
 * third term.
 */
describe('unsentParcalar', () => {
  const catalog = ['KUTU', 'KİTAP', 'KILAVUZ']

  it('names the parçalar the round left behind', () => {
    expect(unsentParcalar(catalog, ['KUTU'], [])).toEqual(['KİTAP', 'KILAVUZ'])
  })

  it('is empty once the round carries them all', () => {
    expect(unsentParcalar(catalog, catalog, [])).toEqual([])
  })

  it('keeps the catalog’s own order', () => {
    // The picker and the printed sheet both read in catalog order; a button
    // listing them in some other order names a different-looking set.
    expect(unsentParcalar(catalog, ['KİTAP'], [])).toEqual(['KUTU', 'KILAVUZ'])
  })

  it('does not offer a parça that is out with the designer', () => {
    // Off the round, but emphatically not "never sent" — it is mid-rework.
    // Sending it to the matbaa would jump the designer's queue.
    const rows = [row('KILAVUZ', { state: 'with_designer', owner_role: 'designer' })]
    expect(unsentParcalar(catalog, ['KUTU'], rows)).toEqual(['KİTAP'])
  })

  it('does not offer one that has already been approved', () => {
    const rows = [row('KILAVUZ', { state: 'approved', owner_role: null })]
    expect(unsentParcalar(catalog, ['KUTU'], rows)).toEqual(['KİTAP'])
  })

  it('does not offer one already back at the gate', () => {
    const rows = [row('KILAVUZ', { state: 'pending', owner_role: null, delivered_at: 'x' })]
    expect(unsentParcalar(catalog, ['KUTU'], rows)).toEqual(['KİTAP'])
  })

  it('matches names the Turkish way', () => {
    // A round that stored "kılavuz" must not read as a fourth parça the leader
    // is invited to send again.
    expect(unsentParcalar(catalog, ['kutu', 'kitap', 'kılavuz'], [])).toEqual([])
  })

  it('reads component objects as well as bare names', () => {
    const objs = [{ component: 'KUTU' }, { component: 'KİTAP' }]
    expect(unsentParcalar(objs, [{ component: 'KUTU' }], [])).toEqual(['KİTAP'])
  })

  it('offers nothing when the catalog has not loaded', () => {
    // The safe failure: no catalog means no button, not a button offering
    // everything on the round back to the matbaa.
    expect(unsentParcalar([], ['KUTU'], [])).toEqual([])
    expect(unsentParcalar(null, ['KUTU'], [])).toEqual([])
  })
})

describe('parça lock predicates', () => {
  it('locked = started and not released', () => {
    expect(parcaEditLocked(onPress('KUTU'))).toBe(true)
    expect(parcaEditLocked(row('KUTU'))).toBe(false)
    // An accepted request un-starts the parça precisely so the fix can land.
    expect(parcaEditLocked(row('KUTU', { fix_pending: true }))).toBe(false)
  })

  it('a parça with no row is not locked — rows exist only once acted on', () => {
    expect(parcaEditLocked(null)).toBe(false)
    expect(parcaEditLocked(undefined)).toBe(false)
  })

  it('askable = locked, with nothing already pending', () => {
    expect(parcaChangeRequestable(onPress('KUTU'))).toBe(true)
    expect(parcaChangeRequestable(row('KUTU'))).toBe(false)
    expect(parcaChangeRequestable({ ...onPress('KUTU'), change_requested_at: 'x' })).toBe(false)
  })

  it('lockedParcaNames / parcalarAwaitingFix name the right subsets', () => {
    const rows = [onPress('KUTU'), row('KİTAP'), row('KILAVUZ', { fix_pending: true })]
    expect(lockedParcaNames(rows)).toEqual(['KUTU'])
    expect(parcalarAwaitingFix(rows)).toEqual(['KILAVUZ'])
    expect(lockedParcaNames([])).toEqual([])
    expect(lockedParcaNames(undefined)).toEqual([])
  })
})

// The edit gates deliberately ignore the locks — see the note above them in
// pipeline.js. A locked parça costs the leader that block, not the button:
// the sheet greys the block out (SpecSheetBody) and the server refuses a save
// that rewrites it (computeDemoEdit). Hiding the button instead took away the
// free edit they still have on every parça the matbaa has not started, which
// is the whole point of splitting a round.
describe('canEditSentDemoRequest keeps the sheet open on a split round', () => {
  it('stays available while one parça is on the press', () => {
    expect(canEditSentDemoRequest(AYSE, demoRound)).toBe(true)
    expect(canEditSentDemoRequest(AYSE, demoRound, [onPress('KUTU'), row('KİTAP')])).toBe(true)
  })

  it('still closes on the whole-sheet flag, which is all-or-nothing', () => {
    expect(canEditSentDemoRequest(AYSE, { ...demoRound, demo_started: true })).toBe(false)
  })

  it('stays team-leader-only', () => {
    expect(canEditSentDemoRequest(OKTAY, demoRound)).toBe(false)
  })

  it('covers the ÇİN demo leg too', () => {
    expect(canEditSentDemoRequest(AYSE, { stage: 'cin_demo_teslim', demo_started: false })).toBe(true)
  })
})

describe('canEditSentOzalitRequest behaves the same way', () => {
  it('stays available with a parça on the press', () => {
    expect(canEditSentOzalitRequest(AYSE, ozalitRound)).toBe(true)
  })

  it('does not resurrect the edit on a round nobody requested', () => {
    expect(canEditSentOzalitRequest(AYSE, { stage: 'ozalit_teslim', ozalit_requested: false })).toBe(false)
  })
})

describe('the cancel gates carry the same lock', () => {
  it('withdrawing the round is off while a parça is on the press', () => {
    expect(canCancelDemoRequest(AYSE, demoRound, [row('KUTU')])).toBe(true)
    expect(canCancelDemoRequest(AYSE, demoRound, [onPress('KUTU'), row('KİTAP')])).toBe(false)
    // Released by an accepted request — the matbaa is not printing it now.
    expect(canCancelDemoRequest(AYSE, demoRound, [row('KUTU', { fix_pending: true })])).toBe(true)
  })

  it('is unchanged with no parça rows', () => {
    expect(canCancelDemoRequest(AYSE, demoRound, [])).toBe(true)
    expect(canCancelDemoRequest(AYSE, demoRound)).toBe(true)
    expect(canCancelDemoRequest(AYSE, { ...demoRound, demo_started: true })).toBe(false)
  })

  it('ozalit cancel keeps its stricter ozalit_requested rule too', () => {
    expect(canCancelOzalitRequest(AYSE, ozalitRound, [row('KAPAK')])).toBe(true)
    expect(canCancelOzalitRequest(AYSE, ozalitRound, [onPress('KAPAK')])).toBe(false)
    // A re-delivery round was never "requested" — cancel stays shut regardless.
    const redelivery = { stage: 'ozalit_teslim', ozalit_requested: false, reject_target: 'matbaa' }
    expect(canCancelOzalitRequest(AYSE, redelivery, [row('KAPAK')])).toBe(false)
  })
})
