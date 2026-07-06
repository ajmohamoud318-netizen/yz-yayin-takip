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

/**
 * Where a rejection sends the order. The team leader reviews the matbaa teslim
 * (the reprint's sales-side ozalit) at `matbaa_onay` and, on rejection, decides
 * which part of the loop re-does the work:
 *   • 'matbaa'   → back to `tasarimci_onay` so Matbaa re-delivers a fresh ozalit
 *                  (design untouched) — the original behaviour.
 *   • 'designer' → back to `goruldu` so the Tasarımcı reworks it first.
 * The ozalit attempt counter increments each time, mirroring a first-edition
 * ozalit rejection (which offers the same Tasarımcı / Matbaa choice).
 */
export const ORDER_REJECT_TARGETS = {
  matbaa_onay: {
    designer: 'goruldu',
    matbaa: 'tasarimci_onay',
  },
}

// Default destination (matbaa re-delivery). Kept so `canReject` checks and any
// caller that doesn't pass a target keep working.
export const ORDER_REJECT_TO = {
  matbaa_onay: 'tasarimci_onay',
}
