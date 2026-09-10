/**
 * ÇİN's teslim leg, client half.
 *
 * The team leader forwards a ÇİN demo from cin_demo_teslim to its approval
 * gate (server computeDemoTeslimAdvance). The button was there but labelled
 * "Demo İsteyin", and the sheet behind it composed a brand-new round as if it
 * were a TR re-send — the wrong document, saved into the next round's slot.
 */

import { describe, it, expect } from 'vitest'

import { VARIANTS, isCinDemoForward } from '@/lib/spec-form-variants'
import { advanceActionLabel, availableActions } from '@/domain/services/project-detail'

const leader = { id: 'u-l', role: 'team_leader' }
const designer = { id: 'u-d', role: 'designer' }
const printer = { id: 'u-p', role: 'printer' }
const cin = { id: 'p1', type: 'CIN', stage: 'cin_demo_teslim', progress: 40, assignees: [{ id: 'u-d' }] }

describe('isCinDemoForward', () => {
  const base = { mode: 'advance', variant: VARIANTS.demo, project: cin, user: leader }

  it('is the team leader advancing the demo sheet at cin_demo_teslim', () => {
    expect(isCinDemoForward(base)).toBe(true)
  })

  it('is nothing else', () => {
    expect(isCinDemoForward({ ...base, user: designer })).toBe(false)
    expect(isCinDemoForward({ ...base, user: printer })).toBe(false)
    expect(isCinDemoForward({ ...base, mode: 'view' })).toBe(false)
    expect(isCinDemoForward({ ...base, variant: VARIANTS.ozalit })).toBe(false)
    expect(isCinDemoForward({ ...base, project: { ...cin, type: 'TR', stage: 'demo_teslim' } })).toBe(false)
    expect(isCinDemoForward({ ...base, orderScoped: true })).toBe(false)
  })
})

describe('the leader’s ÇİN button', () => {
  it('is offered', () => {
    expect(availableActions({ project: cin, user: leader })).toContain('advance')
  })

  it('says what it does', () => {
    expect(advanceActionLabel(cin, 'team_leader')).toBe('Onaya Gönderin')
    // The TR stage keeps its own meaning, and so does the printer's button.
    expect(advanceActionLabel({ ...cin, type: 'TR', stage: 'demo_teslim' }, 'team_leader')).toBe('Demo İsteyin')
    expect(advanceActionLabel(cin, 'printer')).toBe("Demo'yu Teslim Edin")
  })
})
