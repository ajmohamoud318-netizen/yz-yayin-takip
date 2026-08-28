/**
 * Progress % = average of per-subtask completion ratios.
 *
 * Mirrors the server-side `subtaskProgress` in
 * `server/src/domain/progress.js`. Each counted subtask contributes a
 * 0..1 ratio, not a binary: the page chip grid (`kind='pages'`)
 * contributes `pages_done / total_pages` and the sticker subtask
 * (`kind='sticker-count'`) contributes `stickers_done / total_stickers`,
 * so the project progress bar moves incrementally as designers check
 * pages off — instead of jumping from 0% to 100% in one step the moment
 * the last page ships. `kind='check'` subtasks stay binary via
 * `is_done`. The page subtask's `is_done` flag flips to true only when
 * every page is done; progress doesn't read it directly — the chip
 * grid just uses it for the green-check display.
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

/**
 * Per-subtask completion in [0, 1]. Pages and sticker-count kinds pull
 * their ratio from the chip-grid counters; check subtasks fall back to
 * the boolean. A subtask whose kind claims 0 total (misconfigured)
 * falls back to the boolean too — the alternative is NaN in the sum.
 */
function subtaskCompletion(s) {
  if (!s) return 0
  if (s.kind === 'pages') {
    const total = Number(s.total_pages ?? 0)
    if (total > 0) {
      const done = Number(s.pages_done ?? 0)
      return Math.max(0, Math.min(1, done / total))
    }
  }
  if (s.kind === 'sticker-count') {
    const total = Number(s.total_stickers ?? 0)
    if (total > 0) {
      const done = Number(s.stickers_done ?? 0)
      return Math.max(0, Math.min(1, done / total))
    }
  }
  return s.is_done === true ? 1 : 0
}

export function subtaskProgress(subs) {
  const counted = Array.isArray(subs) ? subs.filter(countsTowardProgress) : []
  if (counted.length === 0) return 0
  const score = counted.reduce((sum, s) => sum + subtaskCompletion(s), 0)
  return Math.round((score / counted.length) * 100)
}

/**
 * "Is this subtask done?" predicate. Used both by the progress calculator
 * above AND by `ProjectDetail.jsx`'s header counter ("X / Y tamamlandı") so
 * the two readouts never disagree.
 *
 * Same logic as the server; keep in sync.
 */
export function isSubtaskDone(s) {
  return !!s && s.is_done === true
}
