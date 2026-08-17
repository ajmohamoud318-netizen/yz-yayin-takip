import { nanoid } from 'nanoid'
import { badRequest, forbidden, notFound } from '../domain/errors.js'

/**
 * Hedef Projeler — a lightweight idea board on Baskı Listesi. Designers and
 * the team leader jot down a book concept before it becomes a real project;
 * often just a link someone spotted on Instagram. See migration
 * 036__target_project_ideas.sql.
 */

const COLUMNS = `id, name, notes, link, created_by, created_by_name, created_at`

export async function list(pool) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM target_project_ideas ORDER BY created_at DESC`,
  )
  return rows
}

export async function create(client, { name, notes, link }, actor) {
  const trimmedName = (name ?? '').trim()
  if (!trimmedName) badRequest('İsim boş olamaz.')
  const { rows } = await client.query(
    `INSERT INTO target_project_ideas (id, name, notes, link, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [
      `tpi-${nanoid(16)}`,
      trimmedName,
      notes?.trim() || null,
      link?.trim() || null,
      actor.id,
      actor.name,
    ],
  )
  return rows[0]
}

/** team_leader can remove any idea; anyone else only the one they added. */
export async function remove(pool, id, actor) {
  const { rows } = await pool.query(
    `SELECT created_by FROM target_project_ideas WHERE id = $1`,
    [id],
  )
  if (!rows[0]) notFound('Kayıt bulunamadı.')
  if (actor.role !== 'team_leader' && rows[0].created_by !== actor.id) {
    forbidden('Bu kaydı yalnızca ekleyen kişi veya takım lideri silebilir.')
  }
  await pool.query(`DELETE FROM target_project_ideas WHERE id = $1`, [id])
  return true
}
