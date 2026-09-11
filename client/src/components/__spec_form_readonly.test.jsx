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
 *
 * Reject-to-matbaa (ApprovalDialog → SpecFormDialog with rejectContext) has
 * the same shape — a dialog-level read-only gate on top of the variant's
 * own role/mode rule — so it lives here too: the matbaa must receive the
 * file exactly as they had it when they pressed "İşlemi Başlatın", and the
 * leader reviewing on the way to the rejection button cannot be allowed to
 * silently edit the snapshot out from under them.
 */

import { describe, it, expect } from 'vitest'
import {
  VARIANTS,
  computeBaskiOnayLocked,
  canEditPreparedBaskiOnay,
  isDemoAlreadyApproved,
  isRejectToMatbaaReview,
  isViewerLockedByExistingRound,
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

  // The override used to be the APPROVER's, which quietly undid the two-person
  // gate: they could rewrite the sheet and then sign their own edit. It now
  // belongs to whoever prepared the form, and the server refuses everyone
  // else's write, so an override offered to the approver would only build a
  // button that fails.
  it('ignores the override when the viewer may not edit (the approver)', () => {
    expect(computeBaskiOnayLocked({
      isBaskiOnayApproval: true,
      baskiOnayPrepared: true,
      editOverride: true,
      canEdit: false,
    })).toBe(true)
  })

  it('lets the PREPARER opt back in to editing via the override', () => {
    expect(computeBaskiOnayLocked({
      isBaskiOnayApproval: true,
      baskiOnayPrepared: true,
      editOverride: true,
      canEdit: true,
    })).toBe(false)
  })

  it('still locks the preparer until they ask to edit', () => {
    expect(computeBaskiOnayLocked({
      isBaskiOnayApproval: true,
      baskiOnayPrepared: true,
      editOverride: false,
      canEdit: true,
    })).toBe(true)
  })

  it('coerces missing/undefined flags to false rather than crashing', () => {
    expect(computeBaskiOnayLocked({})).toBe(false)
    expect(computeBaskiOnayLocked({ isBaskiOnayApproval: true })).toBe(false)
  })
})

describe('canEditPreparedBaskiOnay — who owns the Düzenleyin override', () => {
  const A = { id: 'u-a' }
  const B = { id: 'u-b' }
  const prepared = (by) => ({
    stage: 'baski_onay',
    baski_parca_preparers: { KAPAK: { by, by_name: by }, KUTU: { by, by_name: by } },
    baski_parca_approvals: {},
  })

  it('the leader who prepared it may still correct it', () => {
    expect(canEditPreparedBaskiOnay(prepared('u-a'), A)).toBe(true)
  })

  it('the approving leader may not', () => {
    expect(canEditPreparedBaskiOnay(prepared('u-a'), B)).toBe(false)
  })

  it('nobody may once an approval has been recorded', () => {
    const p = { ...prepared('u-a'), baski_parca_approvals: { KAPAK: { by: 'u-b' } } }
    expect(canEditPreparedBaskiOnay(p, A)).toBe(false)
  })

  // One sheet covers every parça, so either leader editing would change
  // content the other has already put their name to.
  it('two leaders having prepared different parçalar closes it for both', () => {
    const p = {
      stage: 'baski_onay',
      baski_parca_preparers: { KAPAK: { by: 'u-a' }, KUTU: { by: 'u-b' } },
      baski_parca_approvals: {},
    }
    expect(canEditPreparedBaskiOnay(p, A)).toBe(false)
    expect(canEditPreparedBaskiOnay(p, B)).toBe(false)
  })

  it('reads the ÇİN ledgers at the ÇİN gate', () => {
    const p = {
      stage: 'cin_baski_onay',
      cin_baski_parca_preparers: { KAPAK: { by: 'u-a' } },
      cin_baski_parca_approvals: {},
    }
    expect(canEditPreparedBaskiOnay(p, A)).toBe(true)
    expect(canEditPreparedBaskiOnay(p, B)).toBe(false)
  })

  it('falls back to the legacy scalar on projects with no per-parça ledger', () => {
    const p = { stage: 'baski_onay', baski_onay_prepared: true, baski_onay_prepared_by: 'u-a' }
    expect(canEditPreparedBaskiOnay(p, A)).toBe(true)
    expect(canEditPreparedBaskiOnay(p, B)).toBe(false)
  })

  it('is safe on a missing project or signed-out user', () => {
    expect(canEditPreparedBaskiOnay(null, A)).toBe(false)
    expect(canEditPreparedBaskiOnay(prepared('u-a'), null)).toBe(false)
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

describe('isRejectToMatbaaReview — locks the form on a reject-to-matbaa handoff', () => {
  const ctx = { reason: 'yanlış dosya', target: 'matbaa' }

  it('returns false when no rejectContext is passed (ordinary compose)', () => {
    expect(isRejectToMatbaaReview(null)).toBe(false)
    expect(isRejectToMatbaaReview(undefined)).toBe(false)
  })

  it('returns true the moment rejectContext is set, regardless of reason', () => {
    // The matbaa gets the file as-is; the reason text only appears in the
    // intro banner and the API call — it doesn't gate the read-only lock.
    expect(isRejectToMatbaaReview(ctx)).toBe(true)
    expect(isRejectToMatbaaReview({ reason: '', target: 'matbaa' })).toBe(true)
  })

  // Regression — the bug this helper exists to fix. The variant's pure
  // rule returns false for a team leader at advance (the dialog used to
  // take this as "editable") and handleAdvance's persistAfterStep then
  // rewrote the round's snapshot on submit, so any accidental edit on the
  // way to "Reddedin ve Gönderin" silently shipped a different file to
  // the matbaa. The dialog's readOnly formula adds this lock on top.
  it('flips the demo sheet to read-only for the team leader at demo_onay', () => {
    const variantLocked = VARIANTS.demo.isReadOnly({ mode: 'advance', user: leader })
    expect(variantLocked).toBe(false)
    expect(isRejectToMatbaaReview(ctx)).toBe(true)
  })

  it('flips the ozalit sheet to read-only for the team leader at ozalit_onay', () => {
    // Same variant rule for ozalit: a team leader at advance is allowed
    // to author the ozalit request. Reject-to-matbaa overrides that.
    const variantLocked = VARIANTS.ozalit.isReadOnly({ mode: 'advance', user: leader })
    expect(variantLocked).toBe(false)
    expect(isRejectToMatbaaReview(ctx)).toBe(true)
  })
})

describe('isViewerLockedByExistingRound — locks the plain viewer over an existing round', () => {
  // The viewer (mode='view') reads the round's snapshot back. Once a snapshot
  // exists, "Taslağı Kaydedin" would silently rewrite it under a half-typed
  // form. Lock the form; the editor path stays open via notifyOnSave.
  const view = { mode: 'view', notifyOnSave: false }

  it('locks the moment the server has a snapshot for the round', () => {
    expect(isViewerLockedByExistingRound(view, { hasServerSnapshot: true, attempt: 0 })).toBe(true)
  })

  it('also locks when the round counter has been bumped past zero (covers the load race)', () => {
    expect(isViewerLockedByExistingRound(view, { hasServerSnapshot: false, attempt: 1 })).toBe(true)
  })

  it('stays open on the very first round — no snapshot, attempt is zero', () => {
    expect(isViewerLockedByExistingRound(view, { hasServerSnapshot: false, attempt: 0 })).toBe(false)
  })

  it('never locks the editor path (notifyOnSave is the editor)', () => {
    expect(isViewerLockedByExistingRound(
      { mode: 'view', notifyOnSave: true },
      { hasServerSnapshot: true, attempt: 1 },
    )).toBe(false)
  })

  it('never locks the compose path (mode=advance)', () => {
    expect(isViewerLockedByExistingRound(
      { mode: 'advance', notifyOnSave: false },
      { hasServerSnapshot: true, attempt: 1 },
    )).toBe(false)
  })

  it('never locks history snapshots — they are read-only by definition', () => {
    expect(isViewerLockedByExistingRound(
      { mode: 'history', notifyOnSave: false },
      { hasServerSnapshot: true, attempt: 1 },
    )).toBe(false)
  })

  it('coerces missing flags and round to false rather than crashing', () => {
    expect(isViewerLockedByExistingRound(null, null)).toBe(false)
    expect(isViewerLockedByExistingRound(undefined, undefined)).toBe(false)
    expect(isViewerLockedByExistingRound({}, {})).toBe(false)
    expect(isViewerLockedByExistingRound({ mode: 'view' }, null)).toBe(false)
    expect(isViewerLockedByExistingRound(view, null)).toBe(false)
  })
})
