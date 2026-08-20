/**
 * Maps a project (stage + progress) to one of the status color keys.
 * Mirrors the CLAUDE.md color rules.
 */

/** True when the leader has already approved a demo at least once,
 *  meaning we're on the second demo cycle (designer finished to
 *  100% and re-sent the demo for the leader to send to Ozalit). */
function isSecondDemoCycle(p) {
  if (!Array.isArray(p.history)) return false
  return p.history.some(
    (h) =>
      h.action === 'approve' &&
      (h.to_stage === 'demo_onay' || h.to_stage === 'cin_demo_onay'),
  )
}

export function statusKeyForProject(p) {
  switch (p.stage) {
    case 'satista':
      return 'yellow'
    case 'uretime_hazir':
      // Retired (migration 047) — kept only as a defensive mapping for any
      // stray historical row a stale client might still render.
      return 'teal'
    case 'baskida':
    case 'gumruk':
      return 'pink'
    case 'ozalit_teslim':
    case 'ozalit_onay':
    case 'baski_onay':
    case 'cin_baski_onay':
      return 'blue'
    case 'demo_teslim':
    case 'cin_demo_teslim':
    case 'demo_onay':
    case 'cin_demo_onay':
      // First demo cycle (leader hasn't approved yet): purple — the
      // project is mid-flow, the design isn't necessarily finished.
      // Second demo cycle (leader approved at <100%, designer
      // reached 100%, designer re-sent): green — the demo is now
      // the "ready for the leader to send to Ozalit" state.
      // BOTH conditions are required for green: an earlier demo
      // approval AND a finished (100%) design. A held approval with
      // the design still incomplete stays purple.
      return isSecondDemoCycle(p) && (p.progress ?? 0) === 100 ? 'green' : 'purple'
    default:
      return p.progress > 0 ? 'purple' : 'orange'
  }
}

/** Dashboard grouping: which bucket a project falls into. */
export function groupKeyForProject(p) {
  if (p.stage === 'tasarim' && p.progress === 0) return 'yeni_proje'
  return 'devam_eden'
}
