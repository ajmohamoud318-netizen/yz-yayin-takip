import { nanoid } from 'nanoid'
import { badRequest, forbidden, notFound } from '../domain/errors.js'

/**
 * Hedef Projeler — a lightweight idea board. Designers and the team leader
 * jot down a book concept before it becomes a real project; often just a
 * link (and now optionally a photo) someone spotted on Instagram. See
 * migration 036__target_project_ideas.sql and
 * 037__target_project_idea_image.sql.
 */

const COLUMNS = `id, name, notes, link, image_url, image_updated_at, created_by, created_by_name, created_at`

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

/**
 * team_leader can modify (delete, or change the image of) any idea;
 * anyone else only the one they added. Shared by remove() and the image
 * routes so an unauthorized caller is rejected before any file I/O happens.
 */
export async function assertCanModify(pool, id, actor) {
  const { rows } = await pool.query(
    `SELECT created_by FROM target_project_ideas WHERE id = $1`,
    [id],
  )
  if (!rows[0]) notFound('Kayıt bulunamadı.')
  if (actor.role !== 'team_leader' && rows[0].created_by !== actor.id) {
    forbidden('Bu kaydı yalnızca ekleyen kişi veya takım lideri düzenleyebilir.')
  }
}

export async function remove(pool, id, actor) {
  await assertCanModify(pool, id, actor)
  await pool.query(`DELETE FROM target_project_ideas WHERE id = $1`, [id])
  return true
}

export async function setImage(pool, id, imageUrl) {
  const { rows } = await pool.query(
    `UPDATE target_project_ideas SET image_url = $2, image_updated_at = NOW()
      WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, imageUrl],
  )
  if (!rows[0]) notFound('Kayıt bulunamadı.')
  return rows[0]
}

export async function clearImage(pool, id) {
  const { rows } = await pool.query(
    `UPDATE target_project_ideas SET image_url = NULL, image_updated_at = NULL
      WHERE id = $1 RETURNING ${COLUMNS}`,
    [id],
  )
  if (!rows[0]) notFound('Kayıt bulunamadı.')
  return rows[0]
}
