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
  baski_onay: {
    kind: 'baski_onay',
    storagePrefix: 'yz_baski_onay_form_',
    dateField:   'baskiOnayTarihi',
    personField: 'baskiOnayHazirlayan',
    dateLabel:   'BASKI ONAY TARİHİ',
    personLabel: 'HAZIRLAYAN',
    // Dedicated fields (unlike demo/ozalit's buried ADET custom row, which
    // never rendered or printed once a project had a catalog — see the load
    // effect below for the fallback chain that fills adetField).
    adetField:     'baskiOnayAdet',
    adetLabel:     'ADET',
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
