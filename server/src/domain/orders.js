export const ORDER_STEPS = ['pending', 'goruldu', 'tasarimci_onay', 'matbaa_onay', 'onaylandi']

export const ORDER_STEP_LABELS = {
  pending: 'Talep',
  goruldu: 'Tasarımcıya Aktarıldı',
  tasarimci_onay: 'Ozalit İstendi',
  matbaa_onay: 'Onay Bekleniyor',
  onaylandi: 'Üretimde',
}

// `matbaa_onay` is multi-party, leader-first (every active team leader AND
// every order assignee must approve — see computeMatbaaOnayApproval in
// order-transitions.js), NOT a flat single-owner step. The 'team_leader'
// value below is only documentary here — routes/orders.js's /advance route
// special-cases matbaa_onay before ever consulting this map.
export const ORDER_STEP_OWNER = {
  pending: 'team_leader',
  goruldu: 'designer',
  tasarimci_onay: 'printer',
  matbaa_onay: 'team_leader',
}

export const ORDER_STEP_NEXT = {
  pending: 'goruldu',
  goruldu: 'tasarimci_onay',
  tasarimci_onay: 'matbaa_onay',
  matbaa_onay: 'onaylandi',
}

export const ORDER_REJECT_TARGETS = {
  matbaa_onay: {
    matbaa: 'tasarimci_onay',
    designer: 'goruldu',
    reassign: 'pending',
  },
}
