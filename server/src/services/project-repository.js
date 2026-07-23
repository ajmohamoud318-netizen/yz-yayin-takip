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
  demo_held, demo_held_at, demo_held_by_name,
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
  // Build a per-project `assignees` array (`[{id, name}, ...]`) from BOTH
  // the project primary (`assigned_to`) AND every distinct per-subtask
  // `assigned_to`. Without the subtask merge, a project where the team
  // leader split the work across Kapak → Rahşan, Kutu → Aylin would
  // show only the primary assignee on the dashboard / Tüm Projeler row
  // and the team leader would never see the second designer until they
  // opened the detail page.
  const ids = rows.map((r) => r.id).filter(Boolean)
  const subAssignees = new Map() // projectId -> [{id, name}, ...]
  if (ids.length > 0) {
    const subRes = await getPool().query(
      `SELECT s.project_id, s.assigned_to, u.name AS assignee_name
         FROM subtasks s
         LEFT JOIN users u ON u.id = s.assigned_to
        WHERE s.project_id = ANY($1) AND s.assigned_to IS NOT NULL`,
      [ids],
    )
    for (const row of subRes.rows) {
      const list = subAssignees.get(row.project_id) ?? []
      list.push({ id: row.assigned_to, name: row.assignee_name })
      subAssignees.set(row.project_id, list)
    }
  }
  // History for every listed project in one query. The client's status
  // color rules (statusKeyForProject → isSecondDemoCycle) read history to
  // tell the first demo cycle (purple) from the second (green). Without it
  // the dashboard rendered purple/"Demo aşamasında: 0" until the user
  // opened a project detail (whose payload does include history), at which
  // point the merged store flipped the same project to green — the color
  // and the counters visibly changed after just opening and closing a
  // project. Shipping the real history with the list keeps every view
  // consistent from first load.
  const historyByProject = new Map() // projectId -> [rows]
  if (ids.length > 0) {
    const histRes = await getPool().query(
      `SELECT h.id, h.project_id, h.from_stage, h.to_stage,
              h.action, h.event, h.reason, h.reject_target,
              h.pass_number, h.done_by, h.note, h.created_at,
              u.name AS done_by_name
         FROM stage_history h
         LEFT JOIN users u ON u.id = h.done_by
        WHERE h.project_id = ANY($1)
        ORDER BY h.created_at, h.id`,
      [ids],
    )
    for (const row of histRes.rows) {
      const list = historyByProject.get(row.project_id) ?? []
      list.push(row)
      historyByProject.set(row.project_id, list)
    }
  }
  return Promise.all(rows.map(async (r) => {
    const project = rowToProject(r)
    project.assigned_name = r.assignee_name ?? null
    project.history = historyByProject.get(r.id) ?? []
    // Build the assignees array from designers who actually have work:
    //   1. everyone with at least one subtask `assigned_to` set
    //   2. project primary (`assigned_to`) — but ONLY if they also have a
    //      subtask. If the team leader reassigned every subtask off the
    //      primary, that primary is no longer a designer on this project
    //      and shouldn't render in the row card / dashboard tile.
    const projectSubAssignees = subAssignees.get(r.id) ?? []
    const subtaskOwnerIds = new Set(projectSubAssignees.map((s) => s.id))
    const seen = new Set()
    const merged = []
    // Subtask assignees first (they're guaranteed to have real work).
    for (const sa of projectSubAssignees) {
      if (seen.has(sa.id)) continue
      seen.add(sa.id)
      merged.push(sa)
    }
    // Project primary only if they're already one of the subtask owners.
    if (project.assigned_to && subtaskOwnerIds.has(project.assigned_to)) {
      // De-dup: the primary may already be in `merged` via the subtask
      // loop. Move them to the front so the avatar stack always leads
      // with the primary (matches the "primary leads" convention used
      // elsewhere in the UI).
      const existingIdx = merged.findIndex((a) => a.id === project.assigned_to)
      if (existingIdx > 0) {
        const [existing] = merged.splice(existingIdx, 1)
        merged.unshift(existing)
      } else if (existingIdx === -1) {
        merged.unshift({ id: project.assigned_to, name: project.assigned_name })
      }
      seen.add(project.assigned_to)
    }
    project.assignees = merged
    return project
  }))
}

/**
 * Resolve the assignee list for a single project. Mirrors the list
 * endpoint: returns the project primary assignee AND every distinct
 * per-subtask assignee, in stable order (primary first, then subtask
 * owners in insertion order, deduped by id). Without the subtask merge
 * a project where the team leader split the work across Kapak → Rahşan,
 * Kutu → Aylin, Ses → Abdijibar would only ship one designer in the
 * detail response and the edit dialog would pre-fill with just that
 * one — the per-subtask designers would silently vanish from the picker.
 *
 * The merge order is intentional: the primary leads so the AssigneeAvatars
 * stack and the "Tasarımcılar" header card on the detail page both render
 * the project owner first, with the per-subtask designers following.
 */
export async function loadProjectAssignees(client, project) {
  if (!project.assigned_to && !(project.id ?? project.project_id)) return []
  const projectId = project.id ?? project.project_id
  const seen = new Set()
  const merged = []
  if (project.assigned_to) {
    const { rows } = await client.query(
      'SELECT id, name FROM users WHERE id = $1',
      [project.assigned_to],
    )
    if (rows[0]) {
      merged.push({ id: rows[0].id, name: rows[0].name })
      seen.add(rows[0].id)
    }
  }
  if (projectId) {
    const { rows } = await client.query(
      `SELECT s.assigned_to, u.name AS assignee_name
         FROM subtasks s
         LEFT JOIN users u ON u.id = s.assigned_to
        WHERE s.project_id = $1 AND s.assigned_to IS NOT NULL
        ORDER BY s.created_at, s.id`,
      [projectId],
    )
    for (const r of rows) {
      if (seen.has(r.assigned_to)) continue
      seen.add(r.assigned_to)
      merged.push({ id: r.assigned_to, name: r.assignee_name })
    }
  }
  return merged
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
  // LEFT JOIN users so each row carries `done_by_name`. Without this the
  // ProjectDetail UI shows the user icon with no name — every entry would
  // render `h.done_by_name` as null because the raw SELECT only returned
  // `done_by` (the foreign key id). The two-pass order keeps the timeline
  // stable even when two rows share the same created_at timestamp (common
  // for batched inserts).
  const { rows } = await client.query(
    `SELECT h.id, h.project_id, h.from_stage, h.to_stage,
            h.action, h.event, h.reason, h.reject_target,
            h.pass_number, h.done_by, h.note, h.created_at,
            u.name AS done_by_name
       FROM stage_history h
       LEFT JOIN users u ON u.id = h.done_by
      WHERE h.project_id = $1
      ORDER BY h.created_at, h.id`,
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
  'demo_attempt',
  'ozalit_attempt',
  'ozalit_leader_approved',
  'ozalit_leader_approved_by',
  'ozalit_leader_approved_at',
  'ozalit_designer_approvals',
  // demo_held trio — flipped by the demo "approve-but-stay" branch in
  // computeApproval and reset when a second demo is sent (computeAdvance).
  'demo_held',
  'demo_held_at',
  'demo_held_by_name',
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
       (project_id, from_stage, to_stage, action, event, reason, reject_target, pass_number, done_by, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      entry.project_id,
      entry.from_stage ?? null,
      entry.to_stage,
      entry.action,
      entry.event ?? 'general',
      entry.reason ?? null,
      entry.reject_target ?? null,
      entry.pass_number ?? 1,
      entry.done_by ?? null,
      entry.note ?? null,
    ],
  )
}

/**
 * Convenience helper that wraps `insertHistory` and automatically tags the
 * entry with the current user's id + name. Route handlers should prefer
 * this call so a forgotten `done_by` doesn't silently produce a nameless
 * timeline row. Falls back to whatever `entry.done_by` / `entry.done_by_name`
 * were passed if `user` is missing (defensive — every route that mutates
 * project state has a logged-in user by the time it gets here).
 */
export async function logHistory(client, entry, user) {
  const doneBy = user?.id ?? entry.done_by ?? null
  const doneByName = user?.name ?? entry.done_by_name ?? null
  return insertHistory(client, {
    ...entry,
    done_by: doneBy,
    // Persist the name in the JSONB-shaped row — we don't have a column for
    // it, but `listProjectHistory` will overwrite it via the JOIN on
    // `done_by`. Setting it here too keeps the object shape consistent
    // when callers read it back from the in-memory return value before
    // refetching.
    done_by_name: doneByName,
  })
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
    demo_held: r.demo_held ?? false,
    demo_held_at: r.demo_held_at instanceof Date
      ? r.demo_held_at.toISOString()
      : r.demo_held_at,
    demo_held_by_name: r.demo_held_by_name ?? null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  }
}
