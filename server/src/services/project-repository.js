/**
 * Project persistence: thin SQL wrapper that mirrors the client repo's
 * surface. Designed for use from route handlers inside `withTx`.
 *
 * Returns plain JS objects shaped for the client. Project history is
 * fetched lazily by `loadHistory` so list endpoints stay light.
 */

import { getPool } from '../db/pool.js'

const PROJECT_COLUMNS = `
  id, title, type, stage, assigned_to, created_by, target_month,
  demo_attempt, ozalit_attempt, pass_number, pass_kind,
  last_reject_reason, progress, version,
  created_at, updated_at
`

export async function listProjects() {
  const { rows } = await getPool().query(
    `SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY created_at DESC, id`,
  )
  return rows.map(rowToProject)
}

export async function getProject(id) {
  const { rows } = await getPool().query(
    `SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = $1`, [id],
  )
  return rows[0] ? rowToProject(rows[0]) : null
}

/** Same shape, but as a single `client.query` argument for use inside `withTx`. */
export async function getProjectForUpdate(client, id) {
  const { rows } = await client.query(
    `SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = $1 FOR UPDATE`, [id],
  )
  return rows[0] ? rowToProject(rows[0]) : null
}

export async function listProjectSubtasks(client, projectId) {
  const { rows } = await client.query(
    `SELECT id, project_id, title, kind, is_done, total_pages, pages_done,
            total_stickers, stickers_done, assigned_to, done_at, created_at, updated_at
       FROM subtasks WHERE project_id = $1 ORDER BY created_at`,
    [projectId],
  )
  return rows
}

export async function listProjectHistory(client, projectId) {
  const { rows } = await client.query(
    `SELECT id, project_id, from_stage, to_stage, action, reason,
            reject_target, pass_number, done_by, note, created_at
       FROM stage_history WHERE project_id = $1
       ORDER BY created_at, id`,
    [projectId],
  )
  return rows
}

export async function patchProject(client, id, fields) {
  const cols = Object.keys(fields)
  if (cols.length === 0) return getProjectForUpdate(client, id)
  const setSql = cols.map((c, i) => `${c} = $${i + 2}`).join(', ')
  const values = cols.map((c) => fields[c])
  const { rows } = await client.query(
    `UPDATE projects SET ${setSql}, updated_at = NOW() WHERE id = $1
     RETURNING ${PROJECT_COLUMNS}`,
    [id, ...values],
  )
  return rows[0] ? rowToProject(rows[0]) : null
}

export async function deleteProject(id) {
  await getPool().query('DELETE FROM projects WHERE id = $1', [id])
}

export async function insertHistory(client, entry) {
  await client.query(
    `INSERT INTO stage_history
       (project_id, from_stage, to_stage, action, reason, reject_target, pass_number, done_by, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      entry.project_id,
      entry.from_stage ?? null,
      entry.to_stage,
      entry.action,
      entry.reason ?? null,
      entry.reject_target ?? null,
      entry.pass_number ?? 1,
      entry.done_by ?? null,
      entry.note ?? null,
    ],
  )
}

export async function insertProject(client, fields) {
  const { rows } = await client.query(
    `INSERT INTO projects
       (title, type, stage, assigned_to, created_by, target_month,
        pass_number, pass_kind, progress, created_at, updated_at)
     VALUES ($1,$2,'tasarim',$3,$4,$5,1,$6,0, NOW(), NOW())
     RETURNING ${PROJECT_COLUMNS}`,
    [
      fields.title,
      fields.type,
      fields.assigned_to ?? null,
      fields.created_by ?? null,
      fields.target_month ?? null,
      fields.pass_kind ?? 'first_edition',
    ],
  )
  return rowToProject(rows[0])
}

function rowToProject(r) {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    stage: r.stage,
    assigned_to: r.assigned_to,
    assigned_name: null, // hydrated by /projects/:id detail route via the users table
    created_by: r.created_by,
    target_month: r.target_month,
    demo_attempt: r.demo_attempt,
    ozalit_attempt: r.ozalit_attempt,
    pass_number: r.pass_number,
    pass_kind: r.pass_kind,
    last_reject_reason: r.last_reject_reason,
    progress: r.progress,
    version: r.version,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  }
}
