/**
 * Maps a project (stage + progress) to one of the status color keys.
 * Mirrors the CLAUDE.md color rules.
 */
export function statusKeyForProject(p) {
  switch (p.stage) {
    case 'satista':
      return 'yellow'
    case 'uretime_hazir':
      return 'teal'
    case 'uretimde':
    case 'gumruk':
      return 'pink'
    case 'ozalit_teslim':
    case 'ozalit_onay':
      return 'blue'
    case 'demo_teslim':
    case 'demo_onay':
    case 'cin_demo_teslim':
    case 'cin_demo_onay':
      return 'green'
    default:
      return p.progress > 0 ? 'purple' : 'orange'
  }
}

/** Dashboard grouping: which bucket a project falls into. */
export function groupKeyForProject(p) {
  if (p.stage === 'tasarim' && p.progress === 0) return 'yeni_proje'
  return 'devam_eden'
}
