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
      // Printer hasn't delivered yet. The project has clearly left
      // tasarim (a demo was requested and accepted into the demo
      // queue), so it's never 'Yeni Proje' (orange) — always
      // 'Devam Eden' (purple). The 0%-progress case (designer sent
      // the demo without ticking any subtasks first) used to fall to
      // orange, which read as 'this is a fresh untouched project' —
      // confusing, since the project is actually mid-flow.
      return 'purple'
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
