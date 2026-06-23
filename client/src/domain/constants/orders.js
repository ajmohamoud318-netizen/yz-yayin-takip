/** Sipariş talep mini-workflow — separate from the main project pipeline. */

export const ORDER_STEPS = ['pending', 'goruldu', 'tasarimci_onay', 'matbaa_onay', 'onaylandi']

export const ORDER_STEP_LABELS = {
  pending: 'Talep Gönderildi',
  goruldu: 'Tasarımcıya Aktarıldı',
  tasarimci_onay: 'Tasarımcı Onayı',
  matbaa_onay: 'Matbaa Teslimi',
  onaylandi: 'Üretime Alındı',
}

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
