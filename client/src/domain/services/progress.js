/**
 * Progress % = completed subtasks / total subtasks × 100.
 *
 * Mirrors the server-side `subtaskProgress` in
 * `server/src/domain/progress.js`. The three subtask kinds each have a
 * distinct "done" predicate:
 *
 *   check         →  s.is_done === true
 *   pages         →  pages_done >= total_pages (cap at > 0 so a
 *                    subtask configured with total_pages=0 doesn't
 *                    trivially count as done)
 *   sticker-count →  stickers_done >= total_stickers
 *
 * Keeping the client function identical to the server matters: the
 * optimistic `progress` written back into the store via `setProject`
 * after a subtask change shouldn't disagree with the value the server
 * computes after the same change, and the dashboard progress bar
 * shouldn't briefly disagree with the header "X / Y tamamlandı"
 * counter.
 */
// "Yazılım" (software) is excluded from progress on purpose — see
// `server/src/domain/progress.js#EXCLUDED_FROM_PROGRESS_TITLE`. It's opt-in
// scope the team leader can select without it ever counting toward (or
// blocking) the 100% needed to enter production.
const EXCLUDED_FROM_PROGRESS_TITLE = 'Yazılım'

/** True for every subtask except "Yazılım", which never gates progress. */
export function countsTowardProgress(s) {
  return s?.title !== EXCLUDED_FROM_PROGRESS_TITLE
}

export function subtaskProgress(subs) {
  const counted = Array.isArray(subs) ? subs.filter(countsTowardProgress) : []
  if (counted.length === 0) return 0
  const done = counted.filter(isSubtaskDone).length
  return Math.round((done / counted.length) * 100)
}

/**
 * Pure kind-aware "is this subtask done?" predicate. Used both by the
 * progress calculator above AND by `ProjectDetail.jsx`'s header counter
 * ("X / Y tamamlandı") so the two readouts never disagree.
 *
 * Same logic as the server; keep in sync.
 */
export function isSubtaskDone(s) {
  if (!s) return false
  if (s.kind === 'pages') {
    return (s.total_pages ?? 0) > 0 && (s.pages_done ?? 0) >= s.total_pages
  }
  if (s.kind === 'sticker-count') {
    return (s.total_stickers ?? 0) > 0 && (s.stickers_done ?? 0) >= s.total_stickers
  }
  return s.is_done === true
}
