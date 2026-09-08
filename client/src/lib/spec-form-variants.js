/**
 * Spec-sheet variant configuration — everything that differs between the
 * Demo, Ozalit and Baskı Onay sheets.
 *
 * Split out of SpecFormDialog.jsx (slice: client god-components): the dialog
 * is one shared component driven entirely by the table below, so the table is
 * a document in its own right — the place to read what each sheet is, who may
 * edit it, and what its buttons say. `VARIANTS` and `specVariantForStage` are
 * re-exported from SpecFormDialog.jsx, so existing imports keep working.
 */

const POST_DEMO_STAGES = new Set([
  'demo_teslim', 'cin_demo_teslim',
  'demo_onay',   'cin_demo_onay',
  'ozalit_teslim','ozalit_onay',
  'baski_onay', 'cin_baski_onay',
  'baskida','gumruk','satista',
])

export const VARIANTS = {
  demo: {
    kind: 'demo',
    storagePrefix: 'yz_demo_form_',
    dateField:   'demoIstemTarihi',
    personField: 'demoIsteyenKisi',
    dateLabel:   'DEMO İSTEM TARİHİ',
    personLabel: 'DEMO İSTEYEN KİŞİ',
    attemptField: 'demo_attempt',
    title: 'Demo Üretim Formu',
    attemptWord: 'Demo',
    attemptUpper: 'DEMO',
    // İŞİN ADI is always the project title — designers can override the value
    // with custom rows but cannot edit the title field. System-driven fields
    // (dates / requester) are likewise never editable by the designer.
    systemFieldsEditable: false,
    // Active editing starts from fresh, keeping only the printer-signed field
    // (matbaaYetkilisi); the system-driven fields auto-recompute.
    restoreSavedOnEdit: false,
    celebrateOnAdvance: true,
    // Kaydet in 'view' mode is not additionally gated on readOnly.
    saveRequiresEditable: false,
    // A demo is REQUESTED from the matbaa, so the sheet has to say something
    // before it goes. Parçalar arrive templated — names down the left, values
    // empty — which made a sheet of pure placeholders perfectly sendable. See
    // lib/spec-form-completeness.js. Saving a half-filled draft stays fine;
    // this gates the send only.
    requiresFilledSpec: true,
    // Matbaa (printer) may view, sign, and forward the demo but must never
    // alter the spec the designer/leader prepared — lock every field for them.
    // History snapshots are read-only for everyone.
    isReadOnly: ({ mode, user }) => mode === 'history' || user?.role === 'printer',
    canPrint: ({ user, project }) =>
      user?.role === 'designer' && !!project?.stage && POST_DEMO_STAGES.has(project.stage),
    advanceToast: (project) =>
      project.type === 'CIN' ? 'Demo gönderildi.' : 'Demo matbaaya gönderildi.',
    advanceLabel: (user) => (user?.role === 'printer' ? "Demo'yu Teslim Edin" : 'Demo İsteyin'),
    saveToast: 'Demo formu kaydedildi.',
  },
  ozalit: {
    kind: 'ozalit',
    storagePrefix: 'yz_ozalit_form_',
    dateField:   'ozalitIstemTarihi',
    personField: 'ozalitIsteyenKisi',
    dateLabel:   'OZALİT İSTEM TARİHİ',
    personLabel: 'OZALİT İSTEYEN KİŞİ',
    attemptField: 'ozalit_attempt',
    title: 'Ozalit Üretim Formu',
    attemptWord: 'Ozalit',
    attemptUpper: 'OZALİT',
    // The team leader authors the ozalit spec, so title/date fields follow the
    // dialog's readOnly state instead of being permanently locked.
    systemFieldsEditable: true,
    restoreSavedOnEdit: true,
    celebrateOnAdvance: false,
    saveRequiresEditable: true,
    // Same bar as the demo: the ozalit is sent to the matbaa to be printed.
    requiresFilledSpec: true,
    // Only the team leader authors the ozalit spec. Everyone else views it:
    //   • the matbaa (printer) receives, signs, and forwards it — never edits;
    //   • the designer can open it (e.g. from Baskı Onayı) but must not
    //     change the spec — they only see and print it.
    // History snapshots are read-only for everyone.
    //
    // mode='approve' is read-only for the LEADER too, which is the one place
    // this variant locks its own author out. The sheet on screen there is the
    // proof the matbaa physically delivered and signed, and approving it means
    // "I accept what came back from the printer" — so it has to be shown
    // exactly as it came back. Editing it during the approve rewrote the
    // record of what was actually printed, and did it silently: approve
    // advances straight to baski_onay, past every path that tells the matbaa a
    // sheet changed (canEditSentOzalitRequest stops at ozalit_teslim). A proof
    // that comes back wrong is a Reddedin → matbaa, not an in-place fix.
    // Covers the sipariş's matbaa_onay approve as well — same sheet, same
    // printer, same reason (see orderOzalitFormMode).
    isReadOnly: ({ mode, user }) =>
      mode === 'history' || mode === 'approve'
      || user?.role === 'printer' || user?.role === 'designer',
    canPrint: () => true,
    advanceToast: () => 'Ozalit onaya gönderildi.',
    advanceLabel: (user) => (user?.role === 'printer' ? 'Ozaliti Teslim Edin' : 'Matbaaya Gönderin'),
    saveToast: 'Ozalit formu kaydedildi.',
  },
  // Baskı Onay Formu — the final print approval at the `baski_onay` gate
  // between ozalit_onay and baskida (TR), reused as-is for ÇİN's mirror gate
  // `cin_baski_onay` between cin_demo_onay and baskida (migration 047) — see
  // STAGE_VARIANT below, which maps both stage names to this one variant.
  // Comes to screen pre-filled with the last ozalit sheet's information for
  // TR, or the last demo sheet's for ÇİN (see the fallback block in the load
  // effect below) and may only be edited by a team_leader ("Serpil Hanım",
  // Ayşenur, …) — every other role sees it read-only. Approval is
  // dual-signature (migration 045): one team leader prepares it (handled
  // below via handlePrepareBaskiOnay), a DIFFERENT team leader approves it
  // (handleApprove) — see the isBaskiOnayApproval block further down. There
  // is no advance mode: the form is auto-created on entering the stage,
  // never requested.
  //
  // The dialog distinguishes the prepare and approve halves of `mode='approve'`
  // using `baski_onay_prepared` and adds a SECOND lock on top of this
  // variant: once the form has been prepared, the approver is signing what
  // was prepared — not authoring — so the dialog forces the form read-only
  // for them and offers a "Düzenleyin" button (SpecFormFooter) to opt back
  // in. The variant's pure role/mode table cannot express that (it would
  // either leave prepare editable or lock the approver out of fixes), so
  // the gate lives next to `baski_onay_prepared` in SpecFormDialog.jsx.
  baski_onay: {
    kind: 'baski_onay',
    storagePrefix: 'yz_baski_onay_form_',
    dateField:   'baskiOnayTarihi',
    personField: 'baskiOnayHazirlayan',
    dateLabel:   'BASKI ONAY TARİHİ',
    personLabel: 'HAZIRLAYAN',
    // BASIM YERİ is a fact about the sheet, so it stays a künye field.
    //
    // ADET is not, and no longer has one. It is the quantity of a single print
    // run and a sipariş can order 5.000 books in 2.500 boxes — one field at the
    // top of the sheet could say only one of those numbers, and the sipariş
    // dialog had resorted to cramming them into a string ("Kitap: 500, Kutu:
    // 250"). It is now a row inside each parça's own spec block, under SAYFA
    // SAYISI, where the matbaa reads it. See lib/spec-form-adet.js.
    //
    // `requiresAdet` says this is the sheet that must carry one — every block
    // on it, before it may be sent. It is also what puts the row there in the
    // first place (useSpecSheet), so a Demo or Ozalit sheet has no ADET row to
    // demand and never fails the check for lacking one.
    requiresAdet: true,
    locationField: 'basimYeri',
    locationLabel: 'BASIM YERİ',
    attemptField: 'baski_onay_attempt',
    title: 'Baskı Onay Formu',
    attemptWord: 'Baskı Onay',
    attemptUpper: 'BASKI ONAY',
    systemFieldsEditable: true,
    restoreSavedOnEdit: true,
    celebrateOnAdvance: false,
    saveRequiresEditable: true,
    isReadOnly: ({ mode, user }) => mode === 'history' || user?.role !== 'team_leader',
    canPrint: () => true,
    advanceToast: () => 'Baskı onaya gönderildi.',
    advanceLabel: () => 'Gönderin',
    saveToast: 'Baskı onay formu kaydedildi.',
  },
}

/** Which spec sheet (if any) a project stage belongs to. */
const STAGE_VARIANT = {
  demo_teslim: 'demo',
  cin_demo_teslim: 'demo',
  demo_onay: 'demo',
  cin_demo_onay: 'demo',
  ozalit_teslim: 'ozalit',
  ozalit_onay: 'ozalit',
  baski_onay: 'baski_onay',
  cin_baski_onay: 'baski_onay',
}

export function specVariantForStage(stage) {
  return STAGE_VARIANT[stage] ?? null
}

/**
 * Baskı Onay approve-step read-only lock.
 *
 * `VARIANTS.baski_onay.isReadOnly` deliberately returns false for a team
 * leader at `mode='approve'` so the leader can still AUTHOR the form during
 * the prepare half of that mode (the dialog uses `mode='approve'` for both
 * halves and discriminates with `baski_onay_prepared`). The dialog then
 * adds this second lock on top: once the form HAS been prepared, the
 * approver is signing what was prepared — not authoring — so the form is
 * read-only by default, with an opt-in "Düzenleyin" override.
 *
 * `canEdit` is the second half of the rule and comes from
 * `canEditPreparedBaskiOnay` below: the override belongs to the leader who
 * PREPARED the form, not to whoever opens it. The approver signing a prepared
 * sheet gets no way in — that is the whole point of the two-person gate, and
 * the server refuses the write regardless (server/src/routes/demos.js), so an
 * override offered here would only produce a button that fails.
 *
 * Inputs are intentionally booleans already computed in the dialog so this
 * helper is pure and testable without mounting SpecFormDialog.
 *
 * @param {{ isBaskiOnayApproval: boolean, baskiOnayPrepared: boolean,
 *           editOverride: boolean, canEdit?: boolean }} flags
 * @returns {boolean}
 */
export function computeBaskiOnayLocked({
  isBaskiOnayApproval, baskiOnayPrepared, editOverride, canEdit = false,
}) {
  if (!isBaskiOnayApproval || !baskiOnayPrepared) return false
  if (!canEdit) return true
  return !editOverride
}

/**
 * May this user still correct a PREPARED baskı onay form?
 *
 * Mirrors the server rule in `server/src/routes/demos.js` exactly — keep the
 * two in step, because this one decides whether the "Düzenleyin" button is
 * offered and that one decides whether the save survives:
 *
 *   • nothing prepared yet  → authoring; this helper is not consulted
 *   • prepared by you alone → yes, until somebody approves
 *   • prepared by anyone else, or by two leaders, or already being approved
 *     → no
 *
 * Two leaders having prepared different parçalar closes it for both: one sheet
 * covers every parça, so either editing would change content the other has
 * already put their name to.
 *
 * @param {object} project
 * @param {{ id?: string } | null | undefined} user
 * @returns {boolean}
 */
export function canEditPreparedBaskiOnay(project, user) {
  if (!project || !user?.id) return false
  const isCin = project.stage === 'cin_baski_onay'
  const preparers = (isCin ? project.cin_baski_parca_preparers : project.baski_parca_preparers) ?? {}
  const approvals = (isCin ? project.cin_baski_parca_approvals : project.baski_parca_approvals) ?? {}
  if (Object.keys(approvals).length > 0) return false
  const preparedBy = new Set(
    Object.values(preparers).map((row) => row?.by).filter(Boolean),
  )
  // Legacy single-parça projects carry the same fact in a scalar.
  if (preparedBy.size === 0 && project.baski_onay_prepared && project.baski_onay_prepared_by) {
    preparedBy.add(project.baski_onay_prepared_by)
  }
  if (preparedBy.size !== 1) return false
  return preparedBy.has(user.id)
}

/**
 * Demo form past its approval gate — the demo is a signed snapshot, not a
 * draft.
 *
 * `tasarim` is pre-demo; `demo_teslim`/`demo_onay`/`cin_demo_teslim`/
 * `cin_demo_onay` are still inside the demo round itself (a rejection can
 * rewind back to `demo_teslim` from `demo_onay`, so those stay editable).
 * Everything past `demo_onay` (TR) or `cin_demo_onay` (CIN) means the demo
 * has been approved and the project has moved on — opening the Demo form
 * from Geçmiş or "Demo Formu" should be a read-only viewer.
 *
 * Mirrors the project-side baski_onay fix: the variant's pure `isReadOnly`
 * can't express this on its own (it doesn't take `project.stage`), so the
 * dialog adds this gate on top.
 *
 * @param {{ stage?: string } | null | undefined} project
 * @returns {boolean}
 */
const DEMO_IN_PROGRESS_STAGES = new Set([
  'tasarim',
  'demo_teslim',
  'demo_onay',
  'cin_demo_teslim',
  'cin_demo_onay',
])

export function isDemoAlreadyApproved(project) {
  if (!project || !project.stage) return false
  return !DEMO_IN_PROGRESS_STAGES.has(project.stage)
}

/**
 * Reject-to-matbaa handoff (ApprovalDialog → SpecFormDialog): the form is
 * opened read-only so the leader reviews without risking an accidental edit
 * that would silently rewrite the snapshot the matbaa is currently working
 * from. The original copy said "the leader reviews/edits"; that turned out
 * to be a footgun — `handleAdvance` writes the loaded payload back to the
 * snapshot on submit, and a stray edit shipped a different file to the
 * matbaa on the next round. Locking here keeps the rule "matbaa gets the
 * file they had when they pressed İşlemi Başlatın" honest.
 *
 * Pure helper — testable without mounting the dialog.
 *
 * @param {null | { reason: string, target: string }} rejectContext
 * @returns {boolean}
 */
export function isRejectToMatbaaReview(rejectContext) {
  return !!rejectContext
}

/**
 * A sheet opened to DECIDE on it, not to author it.
 *
 * The app-wide rule: **a spec sheet that has been sent for approval is a
 * record, not a draft.** Every per-parça button opens the sheet before it
 * commits — the leader's "KUTU · Onaylayın" and "KUTU · Reddedin", the
 * designer's "KUTU · Gönderin" — and what arrives on screen there is the sheet
 * the matbaa produced against. It is the thing being signed, so it opens
 * locked:
 *
 *   • an edit made while approving rewrites the record of what was actually
 *     printed, and does it silently — the approve advances the round past
 *     every path that tells the matbaa a sheet changed;
 *   • an edit made while rejecting ships the matbaa a different file than the
 *     one they worked from, under a reason written about the old one.
 *
 * Same rule `VARIANTS.ozalit` already states for `mode='approve'` and
 * `isRejectToMatbaaReview` states for the reject-to-matbaa handoff. The
 * per-parça decisions can't be expressed either way: they open at
 * `mode='view'` (they reuse the footer slot the matbaa's "İşlemi Başlatın"
 * uses), so no role/mode table can see them. The caller says so instead, by
 * passing the decision the sheet was opened for.
 *
 * A sheet that comes back wrong is a Reddedin → matbaa, or a "Gönderilen
 * Demoyu/Ozaliti Düzenleyin" that notifies them — never an in-place fix under
 * the approve button.
 *
 * Pure helper — testable without mounting the dialog.
 *
 * @param {null | undefined | { action: 'approve' | 'reject' | 'review' }} decisionContext
 * @returns {boolean}
 */
export function isDecisionReview(decisionContext) {
  return !!decisionContext?.action
}
