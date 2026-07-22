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
    case 'cin_demo_teslim':
      // Demo requested / awaiting matbaa delivery. Treated as part
      // of the same 'review checkpoint' phase as ozalit, so it picks
      // up the blue accent. Distinct from tasarim (purple/orange) so
      // the team can see at a glance which projects are blocked on
      // matbaa delivery vs. designer work.
      return 'blue'
    case 'demo_onay':
    case 'cin_demo_onay':
      // Awaiting leader approval. Blue while waiting — the same
      // 'review checkpoint' accent as demo_teslim and the ozalit
      // stages. Once approved at 100% the project is in the
      // 'Demo aşamasında' bucket (green) and immediately advances to
      // ozalit_teslim, so green only appears for the brief moment
      // between approval and the next advance.
      return (p.progress ?? 0) >= 100 ? 'green' : 'blue'
    default:
      return p.progress > 0 ? 'purple' : 'orange'
  }
}

/** Dashboard grouping: which bucket a project falls into. */
export function groupKeyForProject(p) {
  if (p.stage === 'tasarim' && p.progress === 0) return 'yeni_proje'
  return 'devam_eden'
}
