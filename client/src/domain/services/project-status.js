/**
 * Maps a project (stage + progress) to one of the status color keys.
 */

export function statusKeyForProject(p) {
  switch (p.stage) {
    case 'satista':
      return 'yellow'
    case 'baskida':
    case 'gumruk':
    // Retired (migration 047, both collapsed into 'baskida') — kept only as a
    // defensive mapping for any stray historical row a stale client might
    // still render.
    case 'uretime_hazir':
    case 'uretimde':
      return 'pink'
    case 'ozalit_teslim':
    case 'ozalit_onay':
    case 'baski_onay':
    case 'cin_baski_onay':
      return 'blue'
    // Every demo stage has its own color, whatever the round or progress, so
    // a project visibly changes color the moment it leaves tasarım. The two
    // onay stages share the cool family (cyan/teal) and the two teslim stages
    // the bright one (orange/lime); TR vs ÇİN is already on every card. None
    // of them is green — green means "approved" everywhere else in the app.
    case 'demo_teslim':
      return 'orange'
    case 'demo_onay':
      return 'cyan'
    case 'cin_demo_teslim':
      return 'lime'
    case 'cin_demo_onay':
      return 'teal'
    default:
      return p.progress > 0 ? 'purple' : 'gray'
  }
}

/** Dashboard grouping: which bucket a project falls into. */
export function groupKeyForProject(p) {
  if (p.stage === 'tasarim' && p.progress === 0) return 'yeni_proje'
  return 'devam_eden'
}
