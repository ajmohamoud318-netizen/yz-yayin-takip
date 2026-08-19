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

export const STAGE_PIPELINE = {
  TR:  ['tasarim', 'demo_teslim', 'demo_onay', 'ozalit_teslim', 'ozalit_onay', 'baski_onay', 'uretime_hazir', 'uretimde', 'satista'],
  CIN: ['tasarim', 'cin_demo_teslim', 'cin_demo_onay', 'uretime_hazir', 'uretimde', 'gumruk', 'satista'],
}

// Mirrors client/src/domain/constants/stages.js — orderable from "Üretime
// Hazır" onward (Üretimde, Gümrük, Satışta), not just once fully sold
// through. See that file for the full rationale.
export const ORDERABLE_STAGES = new Set(['uretime_hazir', 'uretimde', 'gumruk', 'satista'])

export const HANDOVER_ELIGIBLE_STAGE = { TR: 'uretimde', CIN: 'gumruk' }

/**
 * Stages that require the design to be 100% complete to enter. The gate
 * starts at the print proof (ozalit) — that's where the matbaa actually runs
 * paper through a press and a half-finished design is expensive to recall.
 *
 * Demo stages (demo_teslim, demo_onay, cin_demo_*) are deliberately
 * excluded: a designer (or the team leader) can request a demo at any
 * progress, the matbaa prints the proof, and the team leader approves. If
 * the design wasn't complete the project stays at demo_onay (server's
 * `computeApprove` records the approve but holds the project) until the
 * designer finishes and a second demo is sent.
 */
export const STAGES_REQUIRING_FULL_PROGRESS = new Set([
  'ozalit_teslim', 'ozalit_onay', 'baski_onay',
  'uretime_hazir', 'uretimde', 'gumruk', 'satista',
])
