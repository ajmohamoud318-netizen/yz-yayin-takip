/**
 * What "the same project title" means.
 *
 * The title is the only handle the team ever sees on a project — ids are
 * `p-<nanoid>` and never rendered — so two live projects sharing one are
 * indistinguishable in every list, picker, order form and notification.
 * Titles are therefore unique among live (non-soft-deleted) projects, and
 * this module owns the comparison every write path uses.
 *
 * A reprint is NOT a second project: migration 002 models passes on the
 * same row (pass_number / pass_kind), so a second row carrying an existing
 * title is a double entry, which is exactly what this blocks.
 *
 * Normalisation is NFC + trim + whitespace-collapse + Turkish-locale
 * lowercase, and then the four-way i fold.
 *
 * The locale gets "IŞIK Serisi" == "ışık serisi" right. The fold on top of
 * it exists because Turkish has two i's — i/İ dotted, ı/I dotless — and
 * only a Turkish keyboard produces the dotted capital. Type the same title
 * in caps on a phone set to English, or paste it out of Excel, and you get
 * "MATEMATIK 5" where Turkish wants "MATEMATİK 5"; tr-TR lowercases that to
 * "matematık 5" and the duplicate walks straight past. Since this team is
 * almost entirely on phones, that is the likely way a double entry gets in,
 * so all four letters collapse to one key.
 *
 * The cost is accepted deliberately: two books whose titles differ ONLY by
 * a dotted vs dotless i (Ilık / İlik) can't both exist, and the second one
 * gets a 409 asking for a different name. Catching real double entries is
 * worth that, and the leader can always adjust the title.
 *
 * Migration 065 indexes the same shape in SQL. This function stays the
 * authority — it also folds NFC and the full Unicode space class, which the
 * index doesn't — so the index is a very close, slightly narrower backstop
 * whose whole job is the concurrent-insert race no in-process check sees.
 */

export function normaliseProjectTitle(value) {
  return String(value ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('tr-TR')
    // tr-TR has already sent I→ı and İ→i; this last step puts the dotless
    // and dotted lowercase forms on the same key, so all four land on 'i'.
    .replace(/ı/g, 'i')
}

/** Unique index installed by migration 065. */
export const TITLE_UNIQUE_INDEX = 'idx_projects_title_unique'

/**
 * True for the PG unique-violation raised by that index. Checked on
 * `constraint` rather than the message so a future unique index on
 * projects doesn't get mistaken for a title clash.
 */
export function isTitleConflictError(err) {
  return err?.code === '23505' && err?.constraint === TITLE_UNIQUE_INDEX
}

/**
 * The 409 body. Quotes the *stored* title (not what the leader just typed)
 * when we know it — the casing difference is usually the hint they need to
 * find the existing row. Falls back to an unnamed phrasing for the race
 * path, where all we have is the title the caller was given.
 */
export function titleConflictMessage(existingTitle, stageLabel = null) {
  const name = String(existingTitle ?? '').trim()
  const subject = name ? `"${name}" adında bir proje` : 'Aynı adı taşıyan bir proje'
  const where = stageLabel ? ` (${stageLabel} aşamasında)` : ''
  return `${subject} zaten var${where}. Aynı isimde ikinci bir proje açılamaz — farklı bir ad girin.`
}
