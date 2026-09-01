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
 * The Baskı Onay Formu splits its `mode='approve'` into two halves using
 * `baski_onay_prepared`: prepare (authoring — editable) and approve
 * (signing — read-only by default, with an opt-in "Düzenleyin" override).
 * The variant table below stays pure (role/mode only); the dialog-level
 * gate that flips the prepare/approve half is `computeBaskiOnayLocked`,
 * tested in the same file. Read `spec-form-variants.js`'s baski_onay
 * docblock for the full rationale.
 *
 * The Demo form has its own dialog-level gate: `isDemoAlreadyApproved`
 * locks the demo once the project has moved past `demo_onay`/`cin_demo_onay`
 * — the demo is a signed snapshot at that point, not a draft. Mirrors the
 * Baskı Onay fix in shape; tested in the same file.
 */

import { describe, it, expect } from 'vitest'
import {
  VARIANTS,
  computeBaskiOnayLocked,
  isDemoAlreadyApproved,
} from '@/components/SpecFormDialog'

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

  // The variant itself does NOT distinguish prepare from approve — that
  // distinction belongs to `computeBaskiOnayLocked` below. The variant's
  // job is to be pure role/mode: a team leader at approve is allowed to
  // edit because the dialog opens baskı_onay at mode='approve' for both
  // the prepare and approve halves.
  it('lets the team leader edit at approve (the prepare half needs authoring)', () => {
    expect(isReadOnly('approve', leader)).toBe(false)
  })

  it('is read-only for every other role', () => {
    expect(isReadOnly('approve', designer)).toBe(true)
    expect(isReadOnly('approve', printer)).toBe(true)
  })
})

describe('computeBaskiOnayLocked — dialog-level gate for baskı onay approve', () => {
  it('locks the approve step once the form has been prepared', () => {
    expect(computeBaskiOnayLocked({
      isBaskiOnayApproval: true,
      baskiOnayPrepared: true,
      editOverride: false,
    })).toBe(true)
  })

  it('does not lock the prepare half — the leader is authoring then', () => {
    expect(computeBaskiOnayLocked({
      isBaskiOnayApproval: true,
      baskiOnayPrepared: false,
      editOverride: false,
    })).toBe(false)
  })

  it('does not lock anything outside the baskı onay approval view', () => {
    expect(computeBaskiOnayLocked({
      isBaskiOnayApproval: false,
      baskiOnayPrepared: true,
      editOverride: false,
    })).toBe(false)
  })

  it('lets the approver opt back in to editing via the override', () => {
    expect(computeBaskiOnayLocked({
      isBaskiOnayApproval: true,
      baskiOnayPrepared: true,
      editOverride: true,
    })).toBe(false)
  })

  it('coerces missing/undefined flags to false rather than crashing', () => {
    expect(computeBaskiOnayLocked({})).toBe(false)
    expect(computeBaskiOnayLocked({ isBaskiOnayApproval: true })).toBe(false)
  })
})

describe('isDemoAlreadyApproved — locks the demo past its approval gate', () => {
  it('locks once the project has moved past demo_onay (TR)', () => {
    expect(isDemoAlreadyApproved({ stage: 'ozalit_teslim' })).toBe(true)
    expect(isDemoAlreadyApproved({ stage: 'ozalit_onay' })).toBe(true)
    expect(isDemoAlreadyApproved({ stage: 'baski_onay' })).toBe(true)
    expect(isDemoAlreadyApproved({ stage: 'baskida' })).toBe(true)
    expect(isDemoAlreadyApproved({ stage: 'satista' })).toBe(true)
  })

  it('locks once the project has moved past cin_demo_onay (CIN)', () => {
    expect(isDemoAlreadyApproved({ stage: 'cin_baski_onay' })).toBe(true)
    expect(isDemoAlreadyApproved({ stage: 'baskida' })).toBe(true)
    expect(isDemoAlreadyApproved({ stage: 'gumruk' })).toBe(true)
    expect(isDemoAlreadyApproved({ stage: 'satista' })).toBe(true)
  })

  it('does NOT lock during the demo round itself (so re-send stays editable)', () => {
    expect(isDemoAlreadyApproved({ stage: 'tasarim' })).toBe(false)
    expect(isDemoAlreadyApproved({ stage: 'demo_teslim' })).toBe(false)
    expect(isDemoAlreadyApproved({ stage: 'demo_onay' })).toBe(false)
    expect(isDemoAlreadyApproved({ stage: 'cin_demo_teslim' })).toBe(false)
    expect(isDemoAlreadyApproved({ stage: 'cin_demo_onay' })).toBe(false)
  })

  it('coerces missing/undefined stage to false', () => {
    expect(isDemoAlreadyApproved({})).toBe(false)
    expect(isDemoAlreadyApproved({ stage: undefined })).toBe(false)
    expect(isDemoAlreadyApproved(null)).toBe(false)
    expect(isDemoAlreadyApproved(undefined)).toBe(false)
  })

  it('coerces an unknown stage to true (past the demo, whatever comes next)', () => {
    // A future stage we haven't catalogued yet is past the demo round by
    // definition; the helper should err on the side of locking rather than
    // letting a signed snapshot be silently edited.
    expect(isDemoAlreadyApproved({ stage: 'something_new_in_the_future' })).toBe(true)
  })
})

describe('VARIANTS.demo.isReadOnly', () => {
  it('is unchanged — the demo approve does not run through this dialog', () => {
    expect(VARIANTS.demo.isReadOnly({ mode: 'approve', user: leader })).toBe(false)
    expect(VARIANTS.demo.isReadOnly({ mode: 'advance', user: printer })).toBe(true)
    expect(VARIANTS.demo.isReadOnly({ mode: 'history', user: leader })).toBe(true)
  })
})
