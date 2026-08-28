/**
 * Progress is computed from project subtasks. Server-side source of truth
 * — client sends the new subtask shape (or a single update), and we
 * recompute `projects.progress` in the same transaction.
 *
 * Each counted subtask contributes a 0..1 ratio, not a binary. The page
 * chip grid (`kind='pages'`) reports `pages_done / total_pages` and the
 * sticker subtask (`kind='sticker-count'`) reports `stickers_done /
 * total_stickers` — so the project progress bar moves incrementally as
 * designers check pages off, instead of jumping from 0% to 100% in one
 * step the moment the last page ships. `kind='check'` subtasks still use
 * the `is_done` boolean. `is_done` itself is now purely a derived flag
 * for the chip display (the page subtask's flag flips to true only when
 * every page is done); progress doesn't read it directly.
 *
 * Projects past the design gate (anything in STAGES_REQUIRING_FULL_PROGRESS)
 * are pinned at 100 — the design is frozen once it leaves tasarim.
 */

import { STAGES_REQUIRING_FULL_PROGRESS } from './stages.js'

// "Yazılım" (software) is opt-in scope tracked alongside the rest of a
// project's subtasks, but it doesn't gate the design being "done" — the
// team leader can select it without it ever counting toward (or blocking)
// the 100% needed to enter production. Keep in sync with the client.
const EXCLUDED_FROM_PROGRESS_TITLE = 'Yazılım'

/**
 * Per-subtask completion ratio in [0, 1]. Pages and sticker-count kinds
 * contribute their actual chip-grid / sticker progress, so the project
 * bar tracks real designer work. Check-kind subtasks are binary. A subtask
 * whose kind claims a total of 0 (misconfigured page count, blank sticker
 * total) falls back to the boolean — the alternative is `NaN` sneaking
 * into the sum and poisoning the whole progress calculation.
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

export function subtaskProgress(subtasks = []) {
  const counted = (subtasks ?? []).filter((s) => s.title !== EXCLUDED_FROM_PROGRESS_TITLE)
  if (counted.length === 0) return 0
  const score = counted.reduce((sum, s) => sum + subtaskCompletion(s), 0)
  return Math.round((score / counted.length) * 100)
}

export function progressFor(project, subtasks = []) {
  if (STAGES_REQUIRING_FULL_PROGRESS.has(project.stage)) return 100
  return subtaskProgress(subtasks)
}
