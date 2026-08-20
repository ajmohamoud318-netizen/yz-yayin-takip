export const ORDER_STEPS = [
  'pending', 'goruldu', 'tasarimci_onay', 'ekran_onay', 'matbaa_onay',
  'siparis_baski_onay', 'onaylandi',
]

export const ORDER_STEP_LABELS = {
  pending: 'Talep',
  goruldu: 'Tasarımcıya Aktarıldı',
  tasarimci_onay: 'Ozalit İstendi',
  ekran_onay: 'Ekran Onayı',
  matbaa_onay: 'Onay Bekleniyor',
  siparis_baski_onay: 'Baskı Onayı',
  onaylandi: 'Baskıda',
}

// matbaa_onay is multi-party, leader-first (every active team leader AND
// every order assignee must approve — see computeMatbaaOnayApproval in
// order-transitions.js), NOT a flat single-owner step. The 'team_leader'
// value below is only documentary here — routes/orders.js's /advance route
// special-cases matbaa_onay before ever consulting this map.
//
// ekran_onay IS a flat single-owner step (team_leader, one click, no
// receipt gate, no ledger — unlike matbaa_onay) and rides the same generic
// advance path every other flat step already uses; no dedicated compute
// function needed.
//
// siparis_baski_onay's 'team_leader' entry is documentary only: the
// /advance route explicitly refuses to touch this step — it requires the
// dedicated form-fill-then-approve routes instead (POST .../baski-onay-approve).
export const ORDER_STEP_OWNER = {
  pending: 'team_leader',
  goruldu: 'designer',
  tasarimci_onay: 'printer',
  ekran_onay: 'team_leader',
  matbaa_onay: 'team_leader',
  siparis_baski_onay: 'team_leader',
}

// goruldu's entry below is the DEFAULT/first-submission destination only.
// On a resubmit (order.last_reject_type === 'designer') the /advance route
// overrides `next` with the designer's chosen `route`
// ('tasarimci_onay' | 'ekran_onay') instead of consulting this map.
//
// matbaa_onay now points at siparis_baski_onay, NOT onaylandi — the new
// print-spec gate sits between the physical proof round and production.
// siparis_baski_onay's entry is documentary only (see ORDER_STEP_OWNER
// comment above — it's never reached via the generic advance path).
export const ORDER_STEP_NEXT = {
  pending: 'goruldu',
  goruldu: 'tasarimci_onay',
  tasarimci_onay: 'matbaa_onay',
  ekran_onay: 'siparis_baski_onay',
  matbaa_onay: 'siparis_baski_onay',
  siparis_baski_onay: 'onaylandi',
}

// ekran_onay only offers a 'designer' target — it never touches the
// printer, so there is no 'matbaa' route.
export const ORDER_REJECT_TARGETS = {
  matbaa_onay: {
    matbaa: 'tasarimci_onay',
    designer: 'goruldu',
    reassign: 'pending',
  },
  ekran_onay: {
    designer: 'goruldu',
  },
}
