import { nanoid } from 'nanoid'
import { badRequest, forbidden, notFound } from '../domain/errors.js'

/**
 * Toplantılar — a shared meeting log. Team leader, designers and the
 * printer can note a meeting's title, date, links, and an optional linked
 * project. See migration 040__meetings.sql, image support in 041, and the
 * multi-link / gallery / notes-log detail view in
 * 043__meeting_details.sql.
 *
 * The card grid (list()) only needs the cover image, links and project —
 * the gallery and notes log are fetched together via getDetail() when
 * someone opens a meeting's detail view, so the list stays a single cheap
 * query.
 */

const COLUMNS = `id, title, meeting_at, project_id, links, image_url, image_updated_at, created_by, created_by_name, created_at`
const MAX_LINKS = 10

function normalizeLinks(links) {
  if (!Array.isArray(links)) return []
  return links.map((l) => (l ?? '').trim()).filter(Boolean).slice(0, MAX_LINKS)
}

export async function list(pool) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM meetings ORDER BY meeting_at DESC`,
  )
  return rows
}

function parseMeetingAt(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) badRequest('Geçersiz tarih.')
  return d.toISOString()
}

export async function create(client, { title, links, meeting_at: meetingAt, project_id: projectId }, actor) {
  const trimmedTitle = (title ?? '').trim()
  if (!trimmedTitle) badRequest('Başlık boş olamaz.')
  const { rows } = await client.query(
    `INSERT INTO meetings (id, title, links, meeting_at, project_id, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [
      `mtg-${nanoid(16)}`,
      trimmedTitle,
      normalizeLinks(links),
      parseMeetingAt(meetingAt),
      projectId || null,
      actor.id,
      actor.name,
    ],
  )
  return rows[0]
}

/**
 * team_leader can modify (edit, delete) any meeting; anyone else only the
 * one they added. Mirrors assertCanModify in target-project-ideas.js.
 */
export async function assertCanModify(pool, id, actor) {
  const { rows } = await pool.query(
    `SELECT created_by FROM meetings WHERE id = $1`,
    [id],
  )
  if (!rows[0]) notFound('Kayıt bulunamadı.')
  if (actor.role !== 'team_leader' && rows[0].created_by !== actor.id) {
    forbidden('Bu kaydı yalnızca ekleyen kişi veya takım lideri düzenleyebilir.')
  }
}

export async function update(pool, id, actor, patch) {
  await assertCanModify(pool, id, actor)

  const sets = []
  const values = []
  let i = 1

  if (patch.title !== undefined) {
    const trimmed = (patch.title ?? '').trim()
    if (!trimmed) badRequest('Başlık boş olamaz.')
    sets.push(`title = $${i++}`)
    values.push(trimmed)
  }
  if (patch.links !== undefined) {
    sets.push(`links = $${i++}`)
    values.push(normalizeLinks(patch.links))
  }
  if (patch.meeting_at !== undefined) {
    sets.push(`meeting_at = $${i++}`)
    values.push(parseMeetingAt(patch.meeting_at))
  }
  if (patch.project_id !== undefined) {
    sets.push(`project_id = $${i++}`)
    values.push(patch.project_id || null)
  }

  if (!sets.length) badRequest('Güncellenecek alan yok.')

  values.push(id)
  const { rows } = await pool.query(
    `UPDATE meetings SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${COLUMNS}`,
    values,
  )
  if (!rows[0]) notFound('Kayıt bulunamadı.')
  return rows[0]
}

export async function remove(pool, id, actor) {
  await assertCanModify(pool, id, actor)
  await pool.query(`DELETE FROM meetings WHERE id = $1`, [id])
  return true
}

export async function setImage(pool, id, imageUrl) {
  const { rows } = await pool.query(
    `UPDATE meetings SET image_url = $2, image_updated_at = NOW()
      WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, imageUrl],
  )
  if (!rows[0]) notFound('Kayıt bulunamadı.')
  return rows[0]
}

export async function clearImage(pool, id) {
  const { rows } = await pool.query(
    `UPDATE meetings SET image_url = NULL, image_updated_at = NULL
      WHERE id = $1 RETURNING ${COLUMNS}`,
    [id],
  )
  if (!rows[0]) notFound('Kayıt bulunamadı.')
  return rows[0]
}

// ─── detail view: cover, links and project come from the row above; the
// gallery and notes log live in their own child tables ──────────────────

export async function getDetail(pool, id) {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM meetings WHERE id = $1`, [id])
  if (!rows[0]) notFound('Kayıt bulunamadı.')
  const [images, notes] = await Promise.all([listImages(pool, id), listNotes(pool, id)])
  return { ...rows[0], images, notes }
}

// ─── gallery — extra photos beyond the cover. Callers (routes) gate with
// assertCanModify BEFORE reading a file off the wire, same as the cover
// image route; these functions trust that's already been done ──────────

export async function listImages(pool, meetingId) {
  const { rows } = await pool.query(
    `SELECT id, meeting_id, image_url, created_by, created_at
       FROM meeting_images WHERE meeting_id = $1 ORDER BY created_at ASC`,
    [meetingId],
  )
  return rows
}

/** `imageId` is generated by the caller — it's baked into the on-disk path before this runs. */
export async function addImage(pool, meetingId, imageId, imageUrl, actor) {
  const { rows } = await pool.query(
    `INSERT INTO meeting_images (id, meeting_id, image_url, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, meeting_id, image_url, created_by, created_at`,
    [imageId, meetingId, imageUrl, actor.id],
  )
  return rows[0]
}

export async function removeImage(pool, meetingId, imageId) {
  const { rows } = await pool.query(
    `DELETE FROM meeting_images WHERE id = $1 AND meeting_id = $2 RETURNING id`,
    [imageId, meetingId],
  )
  if (!rows[0]) notFound('Görsel bulunamadı.')
  return true
}

// ─── notes log — a timestamped, multi-author log that replaced the old
// single `notes` textarea. Anyone who can add a meeting can add a note;
// removing one is gated like any other record: team_leader, or the
// note's own author ───────────────────────────────────────────────────

export async function listNotes(pool, meetingId) {
  const { rows } = await pool.query(
    `SELECT id, meeting_id, body, created_by, created_by_name, created_at
       FROM meeting_notes WHERE meeting_id = $1 ORDER BY created_at ASC`,
    [meetingId],
  )
  return rows
}

export async function addNote(pool, meetingId, body, actor) {
  const trimmed = (body ?? '').trim()
  if (!trimmed) badRequest('Not boş olamaz.')
  const { rows: meetingRows } = await pool.query(`SELECT id FROM meetings WHERE id = $1`, [meetingId])
  if (!meetingRows[0]) notFound('Kayıt bulunamadı.')
  const { rows } = await pool.query(
    `INSERT INTO meeting_notes (id, meeting_id, body, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, meeting_id, body, created_by, created_by_name, created_at`,
    [`mtgn-${nanoid(16)}`, meetingId, trimmed, actor.id, actor.name],
  )
  return rows[0]
}

export async function updateNote(pool, meetingId, noteId, body, actor) {
  const trimmed = (body ?? '').trim()
  if (!trimmed) badRequest('Not boş olamaz.')
  const { rows: noteRows } = await pool.query(
    `SELECT created_by FROM meeting_notes WHERE id = $1 AND meeting_id = $2`,
    [noteId, meetingId],
  )
  if (!noteRows[0]) notFound('Not bulunamadı.')
  if (actor.role !== 'team_leader' && noteRows[0].created_by !== actor.id) {
    forbidden('Bu notu yalnızca ekleyen kişi veya takım lideri düzenleyebilir.')
  }
  const { rows } = await pool.query(
    `UPDATE meeting_notes SET body = $2 WHERE id = $1
     RETURNING id, meeting_id, body, created_by, created_by_name, created_at`,
    [noteId, trimmed],
  )
  return rows[0]
}

export async function removeNote(pool, meetingId, noteId, actor) {
  const { rows: noteRows } = await pool.query(
    `SELECT created_by FROM meeting_notes WHERE id = $1 AND meeting_id = $2`,
    [noteId, meetingId],
  )
  if (!noteRows[0]) notFound('Not bulunamadı.')
  if (actor.role !== 'team_leader' && noteRows[0].created_by !== actor.id) {
    forbidden('Bu notu yalnızca ekleyen kişi veya takım lideri silebilir.')
  }
  await pool.query(`DELETE FROM meeting_notes WHERE id = $1`, [noteId])
  return true
}
