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
      // Printer hasn't delivered yet — the project is "in demo", not
      // "in the demo approval bucket". Surface it under the orange/
      // purple devam-eden colors so the "Demo aşamasında" counter
      // only shows projects the leader has actually approved.
      return p.progress > 0 ? 'purple' : 'orange'
    case 'demo_onay':
    case 'cin_demo_onay':
      // Approved demo — but only "really in demo approval" once the
      // design is 100%. Held approvals (<100%) drop to purple so the
      // team leader can tell at a glance which projects are stuck
      // waiting on the designer vs. ready for the next stage.
      return (p.progress ?? 0) >= 100 ? 'green' : 'purple'
    default:
      return p.progress > 0 ? 'purple' : 'orange'
  }
}

/** Dashboard grouping: which bucket a project falls into. */
export function groupKeyForProject(p) {
  if (p.stage === 'tasarim' && p.progress === 0) return 'yeni_proje'
  return 'devam_eden'
}
