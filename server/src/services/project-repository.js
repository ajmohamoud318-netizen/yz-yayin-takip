/**
 * Project persistence: thin SQL wrapper that mirrors the client repo's
 * surface. Designed for use from route handlers inside `withTx`.
 *
 * Returns plain JS objects shaped for the client. Project history is
 * fetched lazily by `loadHistory` so list endpoints stay light.
 */

import { getPool } from '../db/pool.js'
import { nanoid } from 'nanoid'

const PROJECT_COLUMNS = `
  id, title, type, stage, assigned_to, created_by, target_month,
  demo_attempt, ozalit_attempt, pass_number, pass_kind,
  last_reject_reason, progress, version,
  ozalit_leader_approved, ozalit_leader_approved_by, ozalit_leader_approved_at,
  ozalit_designer_approvals,
  created_at, updated_at
`

export async function listProjects() {
  // LEFT JOIN the assignee so the list path returns a fully-hydrated
  // `assigned_name`. Without this every project card on the dashboard
  // crashed with "Cannot read properties of null (reading 'split')"
  // because `project-mapper.js` passed the null straight into
  // `initials(project.assigned_name)`. The `assigned_name = $alias`
  // fallback keeps unassigned projects rendering "—".
  const { rows } = await getPool().query(
    `SELECT ${PROJECT_COLUMNS.split(',').map((c) => 'p.' + c.trim()).join(', ')}
       , a.name AS assignee_name
     FROM projects p
     LEFT JOIN users a ON a.id = p.assigned_to
     ORDER BY p.created_at DESC, p.id`,
  )
  // Hydrate a per-project `assignees` array (`[{id, name}, ...]`) so
  // list-side consumers (MyProjects filter, Dashboard cards, navigation)
  // don't need to round-trip to /api/projects/:id just to know who's
  // on the project. Today the only source of truth is the legacy
  // `projects.assigned_to` single column, so `assignees` is a 1-element
  // array when one user is assigned and empty when none is — but it
  // matches the shape the detail endpoint already returns, which is
  // what the client (`client/src/application/mappers/project-mapper.js`
  // and `client/src/pages/MyProjects.jsx`) consumes.
  return Promise.all(rows.map(async (r) => {
    const project = rowToProject(r)
    project.assigned_name = r.assignee_name ?? null
    project.assignees = project.assigned_to
      ? [{ id: project.assigned_to, name: project.assigned_name }]
      : []
    return project
  }))
}

/**
 * Resolve the assignee list for a single project. Mirrors the list
 * endpoint: today the only source of truth is `projects.assigned_to`,
 * so this is a 1-row lookup. Kept here (rather than in the route
 * file) so both listProjects and the detail route use one helper.
 */
export async function loadProjectAssignees(client, project) {
  if (!project.assigned_to) return []
  const { rows } = await client.query(
    'SELECT id, name FROM users WHERE id = $1',
    [project.assigned_to],
  )
  return rows
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
  // LEFT JOIN users so each row carries `assigned_name`. Without this the
  // ProjectDetail UI can show "Kapak → u-1bMgmt0PcKOpGdvC" (raw id) because
  // it has no way to resolve the user name client-side without a separate
  // /api/users round trip per row.
  const { rows } = await client.query(
    `SELECT s.id, s.project_id, s.title, s.kind, s.is_done, s.total_pages, s.pages_done,
            s.total_stickers, s.stickers_done, s.assigned_to, s.done_at,
            s.created_at, s.updated_at,
            u.name AS assigned_name
       FROM subtasks s
       LEFT JOIN users u ON u.id = s.assigned_to
       WHERE s.project_id = $1
       ORDER BY s.created_at`,
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

// Columns writable on projects. Anything else arriving in `fields` is
// dropped here so a schema-accepted but column-less key (assignees,
// subtasks, subtaskAssignees, pageCount, stickerCount) can't reach the
// SQL and 500 on a "column does not exist" PG error.
const PROJECT_WRITABLE_COLUMNS = new Set([
  'title',
  'type',
  'target_month',
  'assigned_to',
  'stage',
  'progress',
  'version',
  'last_reject_reason',
  'ozalit_leader_approved',
  'ozalit_leader_approved_by',
  'ozalit_leader_approved_at',
  'ozalit_designer_approvals',
])

export async function patchProject(client, id, fields) {
  // Translate the SPA's `assignees[0]` convenience field into the
  // `assigned_to` column the projects table actually has. The SPA
  // payload includes `assignees` as a convenience for multi-select
  // UIs; we only persist the first one (the primary owner).
  if (Array.isArray(fields.assignees)) {
    fields = {
      ...fields,
      assigned_to: fields.assignees[0] ?? null,
    }
    delete fields.assignees
  }
  const cols = Object.keys(fields).filter((c) => PROJECT_WRITABLE_COLUMNS.has(c))
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
  // The projects table has `id TEXT PRIMARY KEY` with no default — we
  // mint a `p-<nanoid>` here so the INSERT doesn't violate the not-null
  // constraint. The prefix keeps it visually distinct from user (u-…)
  // and order/handover ids, and nanoid(16) gives plenty of entropy for
  // a small-to-medium team.
  const projectId = fields.id ?? `p-${nanoid(16)}`
  const { rows } = await client.query(
    `INSERT INTO projects
       (id, title, type, stage, assigned_to, created_by, target_month,
        pass_number, pass_kind, progress, created_at, updated_at)
     VALUES ($1,$2,$3,'tasarim',$4,$5,$6,1,$7,0, NOW(), NOW())
     RETURNING ${PROJECT_COLUMNS}`,
    [
      projectId,
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
    ozalit_leader_approved: r.ozalit_leader_approved,
    ozalit_leader_approved_by: r.ozalit_leader_approved_by,
    ozalit_leader_approved_at: r.ozalit_leader_approved_at instanceof Date
      ? r.ozalit_leader_approved_at.toISOString()
      : r.ozalit_leader_approved_at,
    ozalit_designer_approvals: r.ozalit_designer_approvals ?? [],
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  }
}
