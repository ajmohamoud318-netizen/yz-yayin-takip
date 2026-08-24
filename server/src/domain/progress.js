/**
 * Progress is computed from project subtasks. Server-side source of truth
 * — client sends the new subtask shape (or a single update), and we
 * recompute `projects.progress` in the same transaction.
 *
 * Every subtask counts as done when `is_done` is true — including the
 * `pages`/`sticker-count` kinds ("İç Sayfalar", "Sticker"), which used to
 * derive "done" from a counter (pages_done/stickers_done >= total) instead.
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

export function subtaskProgress(subtasks = []) {
  const counted = (subtasks ?? []).filter((s) => s.title !== EXCLUDED_FROM_PROGRESS_TITLE)
  if (counted.length === 0) return 0
  const done = counted.filter((s) => s.is_done).length
  return Math.round((done / counted.length) * 100)
}

export function progressFor(project, subtasks = []) {
  if (STAGES_REQUIRING_FULL_PROGRESS.has(project.stage)) return 100
  return subtaskProgress(subtasks)
}
