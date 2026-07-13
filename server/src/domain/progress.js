/**
 * Progress is computed from project subtasks. Server-side source of truth
 * — client sends the new subtask shape (or a single update), and we
 * recompute `projects.progress` in the same transaction.
 *
 * Numeric subtasks ("Sayfa Sayısı", "Sticker") count as done when their
 * done count >= total. Check subtasks count as done when `is_done` is
 * true.
 *
 * Projects past the design gate (anything in STAGES_REQUIRING_FULL_PROGRESS)
 * are pinned at 100 — the design is frozen once it leaves tasarim.
 */

import { STAGES_REQUIRING_FULL_PROGRESS } from './stages.js'

export function subtaskProgress(subtasks = []) {
  if (!Array.isArray(subtasks) || subtasks.length === 0) return 0
  let done = 0
  for (const s of subtasks) {
    if (s.kind === 'pages') {
      if ((s.total_pages ?? 0) > 0 && (s.pages_done ?? 0) >= s.total_pages) done++
    } else if (s.kind === 'sticker-count') {
      if ((s.total_stickers ?? 0) > 0 && (s.stickers_done ?? 0) >= s.total_stickers) done++
    } else if (s.is_done) {
      done++
    }
  }
  return Math.round((done / subtasks.length) * 100)
}

export function progressFor(project, subtasks = []) {
  if (STAGES_REQUIRING_FULL_PROGRESS.has(project.stage)) return 100
  return subtaskProgress(subtasks)
}
