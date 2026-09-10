/** Subtask catalog used by NewProjectDialog. */
export const SUBTASK_LIBRARY = [
  { key: 'kapak', label: 'Kapak' },
  { key: 'sayfalar', label: 'İç Sayfalar', kind: 'pages' },
  { key: 'kutu', label: 'Kutu' },
  { key: 'kilavuz', label: 'Kılavuz' },
  { key: 'sticker', label: 'Sticker' },
  { key: 'media', label: 'Media' },
  { key: 'ses', label: 'Ses' },
  { key: 'yazilim', label: 'Yazılım' },
]

/**
 * The subtask kinds logged as numbered designer batches ("Ayşe sayfa 1-5
 * ekledi"), and what each one counts. Sticker joined İç Sayfalar in
 * migration 082 — it used to be a bare checkbox. Mirror of
 * server/src/domain/page-segments.js#batchCounter.
 */
const BATCH_COUNTERS = {
  pages: { total: 'total_pages', done: 'pages_done', unit: 'sayfa', unitTitle: 'Sayfa' },
  'sticker-count': { total: 'total_stickers', done: 'stickers_done', unit: 'sticker', unitTitle: 'Sticker' },
}

/** The counter a subtask kind logs batches against, or null if it doesn't. */
export function batchCounter(kind) {
  return BATCH_COUNTERS[kind] ?? null
}
