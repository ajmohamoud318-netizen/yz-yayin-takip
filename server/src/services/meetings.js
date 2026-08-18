import { nanoid } from 'nanoid'
import { badRequest, forbidden, notFound } from '../domain/errors.js'

/**
 * Toplantılar — a shared meeting log. Team leader, designers and the
 * printer can note a meeting's title, date/time, optional notes, and an
 * optional linked project. See migration 040__meetings.sql.
 */

const COLUMNS = `id, title, notes, meeting_at, project_id, created_by, created_by_name, created_at`

export async function list(pool) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM meetings ORDER BY meeting_at DESC`,
  )
  return rows
}

function parseMeetingAt(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) badRequest('Geçersiz tarih/saat.')
  return d.toISOString()
}

export async function create(client, { title, notes, meeting_at: meetingAt, project_id: projectId }, actor) {
  const trimmedTitle = (title ?? '').trim()
  if (!trimmedTitle) badRequest('Başlık boş olamaz.')
  const { rows } = await client.query(
    `INSERT INTO meetings (id, title, notes, meeting_at, project_id, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNS}`,
    [
      `mtg-${nanoid(16)}`,
      trimmedTitle,
      notes?.trim() || null,
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
  if (patch.notes !== undefined) {
    sets.push(`notes = $${i++}`)
    values.push(patch.notes?.trim() || null)
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
