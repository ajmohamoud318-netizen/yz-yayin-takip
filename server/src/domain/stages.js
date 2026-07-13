export const STAGE_LABELS = {
  tasarim: 'Tasarım',
  demo_teslim: 'Demo Teslim',
  demo_onay: 'Demo Onay',
  ozalit_teslim: 'Ozalit Teslim',
  ozalit_onay: 'Ozalit Onay',
  cin_demo_teslim: 'Çin Demo Teslim',
  cin_demo_onay: 'Çin Demo Onay',
  uretime_hazir: 'Üretime Hazır',
  uretimde: 'Üretimde',
  gumruk: 'Gümrük',
  satista: 'Satışta',
}

export const STAGE_PIPELINE = {
  TR:  ['tasarim', 'demo_teslim', 'demo_onay', 'ozalit_teslim', 'ozalit_onay', 'uretime_hazir', 'uretimde', 'satista'],
  CIN: ['tasarim', 'cin_demo_teslim', 'cin_demo_onay', 'uretime_hazir', 'uretimde', 'gumruk', 'satista'],
}

export const ORDERABLE_STAGES = new Set(['satista'])

export const HANDOVER_ELIGIBLE_STAGE = { TR: 'uretimde', CIN: 'gumruk' }

export const STAGES_REQUIRING_FULL_PROGRESS = new Set([
  'demo_teslim', 'cin_demo_teslim',
  'demo_onay',   'cin_demo_onay',
  'ozalit_teslim', 'ozalit_onay',
  'uretime_hazir', 'uretimde', 'gumruk', 'satista',
])
