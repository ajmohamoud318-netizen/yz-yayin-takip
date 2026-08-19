export const STAGE_LABELS = {
  tasarim: 'Tasarım',
  demo_teslim: 'Demo Teslim',
  demo_onay: 'Demo Onay',
  ozalit_teslim: 'Ozalit Teslim',
  ozalit_onay: 'Ozalit Onay',
  baski_onay: 'Baskı Onayı',
  cin_demo_teslim: 'Çin Demo Teslim',
  cin_demo_onay: 'Çin Demo Onay',
  uretime_hazir: 'Üretime Hazır',
  uretimde: 'Üretimde',
  gumruk: 'Gümrük',
  satista: 'Satışta',
}

/**
 * Stages where a demo or ozalit round is actively in flight — someone
 * (matbaa or leader/designer) has a delivery or approval pending. Used to
 * warn the team leader before deleting a project that would otherwise just
 * vanish from that person's queue mid-process.
 */
export const IN_FLIGHT_DEMO_OZALIT_STAGES = new Set([
  'demo_teslim', 'demo_onay', 'ozalit_teslim', 'ozalit_onay', 'baski_onay',
  'cin_demo_teslim', 'cin_demo_onay',
])

export const STAGE_PIPELINE = {
  TR: ['tasarim', 'demo_teslim', 'demo_onay', 'ozalit_teslim', 'ozalit_onay', 'baski_onay', 'uretime_hazir', 'uretimde', 'satista'],
  CIN: ['tasarim', 'cin_demo_teslim', 'cin_demo_onay', 'uretime_hazir', 'uretimde', 'gumruk', 'satista'],
}

/**
 * Business rule: Sales can raise a sipariş (order) request once a project has
 * reached "Üretime Hazır" or any stage after it (Üretimde, Gümrük, Satışta) —
 * i.e. once production work is actually finished, not only once it has fully
 * sold through. This lets Sales queue a reorder ahead of the first batch
 * selling out, while still covering already-sold (Satışta) products. The
 * project still needs a Ürün Bilgileri entry (`has_product_info`) before an
 * order can actually be placed — see `canRequestOrder` / `assertOrderable`.
 */
export const ORDERABLE_STAGES = new Set(['uretime_hazir', 'uretimde', 'gumruk', 'satista'])

/**
 * The final production stage a project rests in before Sales confirms the
 * physical handover ("teslim"). Matbaa raises a handover request here; Sales
 * confirming "Alındı" moves the project to Satışta.
 *   TR:  uretimde → satista
 *   ÇİN: gumruk   → satista (after customs)
 */
export const HANDOVER_ELIGIBLE_STAGE = { TR: 'uretimde', CIN: 'gumruk' }
