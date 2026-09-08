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

describe('canEditSentDemoRequest with a split round', () => {
  it('still allows the sheet edit while the matbaa has started nothing', () => {
    expect(canEditSentDemoRequest(AYSE, demoRound, [row('KUTU'), row('KİTAP')])).toBe(true)
  })

  // The regression itself: demo_started is false here, which is exactly why
  // the old gate said yes.
  it('closes the sheet edit once ONE parça is on the press', () => {
    expect(canEditSentDemoRequest(AYSE, demoRound, [onPress('KUTU'), row('KİTAP')])).toBe(false)
  })

  it('reopens it once the matbaa accepts the change request', () => {
    // What acceptParcaChange leaves behind: un-started, carrying the debt.
    const released = [row('KUTU', { fix_pending: true }), row('KİTAP')]
    expect(canEditSentDemoRequest(AYSE, demoRound, released)).toBe(true)
  })

  it('is unchanged with no parça rows — legacy and single-parça rounds', () => {
    expect(canEditSentDemoRequest(AYSE, demoRound, [])).toBe(true)
    expect(canEditSentDemoRequest(AYSE, demoRound)).toBe(true)
    expect(canEditSentDemoRequest(AYSE, { ...demoRound, demo_started: true }, [])).toBe(false)
  })

  it('stays team-leader-only', () => {
    expect(canEditSentDemoRequest(OKTAY, demoRound, [row('KUTU')])).toBe(false)
  })

  it('covers the ÇİN demo leg too', () => {
    const cin = { stage: 'cin_demo_teslim', demo_started: false }
    expect(canEditSentDemoRequest(AYSE, cin, [onPress('KUTU')])).toBe(false)
    expect(canEditSentDemoRequest(AYSE, cin, [row('KUTU')])).toBe(true)
  })
})

describe('canEditSentOzalitRequest carries the same lock', () => {
  it('closes once one parça is on the press, reopens on accept', () => {
    expect(canEditSentOzalitRequest(AYSE, ozalitRound, [row('KAPAK')])).toBe(true)
    expect(canEditSentOzalitRequest(AYSE, ozalitRound, [onPress('KAPAK')])).toBe(false)
    expect(canEditSentOzalitRequest(AYSE, ozalitRound, [row('KAPAK', { fix_pending: true })])).toBe(true)
  })

  it('does not resurrect the edit on a round nobody requested', () => {
    const idle = { stage: 'ozalit_teslim', ozalit_requested: false }
    expect(canEditSentOzalitRequest(AYSE, idle, [row('KAPAK')])).toBe(false)
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
