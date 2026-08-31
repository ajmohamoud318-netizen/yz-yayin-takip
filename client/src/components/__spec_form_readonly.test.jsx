/**
 * VARIANTS.isReadOnly — who may type into which spec sheet, and when.
 *
 * The rule this file exists for: at mode='approve' the ozalit sheet is the
 * proof the matbaa physically delivered and signed, so it is shown exactly as
 * delivered and nobody — the authoring team leader included — may edit it
 * while approving. Approve advances straight to baski_onay, past every path
 * that notifies the matbaa a sheet changed, so an edit here silently rewrote
 * the record of what was actually printed. A wrong proof is a Reddedin →
 * matbaa instead.
 *
 * The Baskı Onay Formu is deliberately NOT covered by that rule: a team leader
 * authors that document, so it stays editable for them at approve.
 */

import { describe, it, expect } from 'vitest'
import { VARIANTS } from '@/components/SpecFormDialog'

const leader = { id: 'u-lead', role: 'team_leader' }
const designer = { id: 'u-des', role: 'designer' }
const printer = { id: 'u-mat', role: 'printer' }

describe('VARIANTS.ozalit.isReadOnly', () => {
  const isReadOnly = (mode, user) => VARIANTS.ozalit.isReadOnly({ mode, user })

  it('locks the approve view for the team leader who authors the sheet', () => {
    expect(isReadOnly('approve', leader)).toBe(true)
  })

  it('locks the approve view for the assigned designer too (sipariş matbaa_onay)', () => {
    expect(isReadOnly('approve', designer)).toBe(true)
  })

  it('still lets the team leader author the sheet outside approve', () => {
    expect(isReadOnly('advance', leader)).toBe(false)
    expect(isReadOnly('view', leader)).toBe(false)
  })

  it('keeps the existing role and history locks', () => {
    expect(isReadOnly('advance', printer)).toBe(true)
    expect(isReadOnly('advance', designer)).toBe(true)
    expect(isReadOnly('history', leader)).toBe(true)
  })
})

describe('VARIANTS.baski_onay.isReadOnly', () => {
  const isReadOnly = (mode, user) => VARIANTS.baski_onay.isReadOnly({ mode, user })

  it('stays editable for a team leader at approve — they author this one', () => {
    expect(isReadOnly('approve', leader)).toBe(false)
  })

  it('is read-only for every other role', () => {
    expect(isReadOnly('approve', designer)).toBe(true)
    expect(isReadOnly('approve', printer)).toBe(true)
  })
})

describe('VARIANTS.demo.isReadOnly', () => {
  it('is unchanged — the demo approve does not run through this dialog', () => {
    expect(VARIANTS.demo.isReadOnly({ mode: 'approve', user: leader })).toBe(false)
    expect(VARIANTS.demo.isReadOnly({ mode: 'advance', user: printer })).toBe(true)
    expect(VARIANTS.demo.isReadOnly({ mode: 'history', user: leader })).toBe(true)
  })
})
