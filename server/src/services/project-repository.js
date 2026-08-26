/**
 * Project persistence: thin SQL wrapper that mirrors the client repo's
 * surface. Designed for use from route handlers inside `withTx`.
 *
 * Returns plain JS objects shaped for the client. Project history is
 * fetched lazily by `loadHistory` so list endpoints stay light.
 */

import { getPool, withTx } from '../db/pool.js'
import { nanoid } from 'nanoid'

const PROJECT_COLUMNS = `
  id, title, type, stage, assigned_to, created_by, target_month,
  demo_attempt, ozalit_attempt, pass_number, pass_kind,
  last_reject_reason, progress, version,
  ozalit_leader_approved, ozalit_leader_approved_by, ozalit_leader_approved_at,
  ozalit_designer_approvals,
  demo_held, demo_held_at, demo_held_by_name,
  demo_received, demo_received_by, demo_received_at,
  ozalit_received, ozalit_received_by, ozalit_received_at,
  baski_onay_prepared, baski_onay_prepared_by, baski_onay_prepared_by_name, baski_onay_prepared_at,
  demo_delivered_at, demo_delivered_by,
  ozalit_requested, reject_target, last_reject_type, last_reject_target,
  ozalit_approvals,
  demo_started, demo_started_at, demo_started_by, demo_started_by_name,
  demo_change_requested_at, demo_change_requested_by, demo_change_requested_by_name, demo_change_requested_note,
  demo_fix_pending,
  ozalit_started, ozalit_started_at, ozalit_started_by, ozalit_started_by_name,
  ozalit_change_requested_at, ozalit_change_requested_by, ozalit_change_requested_by_name, ozalit_change_requested_note,
  ozalit_fix_pending,
  ekran_demo_requested_at, ekran_demo_requested_by, ekran_demo_requested_by_name,
  origin,
  catalog_hidden, catalog_hidden_at, catalog_hidden_by,
  created_at, updated_at,
  deleted_at, deleted_by, deleted_by_name
`

/**
 * `demo_delivered_by_name`, resolved live from `users` instead of read back
 * from the snapshot `computeDemoTeslimAdvance` stamped at delivery time.
 *
 * The stored column froze whatever the account was called on the day the
 * matbaa delivered, so renaming a user (the realistic fix when a shared login
 * like "yukselen zeka" turns out to be doing the deliveries) left this field
 * reading the old string forever — while the timeline right next to it, which
 * resolves `done_by` through a LEFT JOIN at read time, showed the new one.
 * Same bug class as the nameless history rows that JOIN was added to fix.
 *
 * COALESCE rather than a bare lookup, because the snapshot is still worth
 * something: if the user row is ever deleted the live name goes null and the
 * frozen string is all that's left of who delivered it. Live name wins when
 * there is one; the snapshot is the floor. That's the same shape as
 * `deleted_by` / `deleted_by_name` elsewhere in this table.
 *
 * Written as a scalar subquery, not a LEFT JOIN, because this expression has
 * to survive three different contexts: a plain SELECT, a `RETURNING` clause
 * (patchProject), and a `SELECT ... FOR UPDATE` (getProjectForUpdate). A join
 * would break the last one — Postgres refuses FOR UPDATE on the nullable side
 * of an outer join — and would need `FOR UPDATE OF projects` plus a different
 * column prefix at every call site. A subquery is a separate query level, so
 * it locks nothing and reads the same everywhere.
 *
 * `table` is the name the enclosing query uses for `projects` ('p' in the
 * joined list query, 'projects' in the single-row ones).
 */
const deliveredByNameSql = (table) => `
  COALESCE(
    (SELECT u.name FROM users u WHERE u.id = ${table}.demo_delivered_by),
    ${table}.demo_delivered_by_name
  ) AS demo_delivered_by_name
`

export async function listProjects() {
  // LEFT JOIN the assignee so the list path returns a fully-hydrated
  // `assigned_name`. Without this every project card on the dashboard
  // crashed with "Cannot read properties of null (reading 'split')"
  // because `project-mapper.js` passed the null straight into
  // `initials(project.assigned_name)`. The `assigned_name = $alias`
  // fallback keeps unassigned projects rendering "—".
  const { rows } = await getPool().query(
    // NB: the `p.`-prefixing below splits PROJECT_COLUMNS on commas, so that
    // constant must stay a flat list of bare column names — derived
    // expressions are appended separately, already qualified.
    `SELECT ${PROJECT_COLUMNS.split(',').map((c) => 'p.' + c.trim()).join(', ')}
       , ${deliveredByNameSql('p')}
       , a.name AS assignee_name
       -- The components check is not redundant with EXISTS: Ürün Bilgileri's
       -- "Ürünü Sil" clears a product's spec by saving an EMPTY components
       -- array, so the row keeps existing. A bare EXISTS reported
       -- has_product_info=true for those, and Sales could still raise an order
       -- against a product with a blank spec sheet.
       , EXISTS(SELECT 1 FROM product_info pi WHERE pi.project_id = p.id AND pi.components <> '[]'::jsonb) AS has_product_info
     FROM projects p
     LEFT JOIN users a ON a.id = p.assigned_to
     WHERE p.deleted_at IS NULL
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
              h.pass_number, h.done_by, h.note, h.demo_id, h.created_at,
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
        ORDER BY s.position, s.created_at, s.id`,
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
    `SELECT ${PROJECT_COLUMNS}
       , ${deliveredByNameSql('projects')}
       , EXISTS(SELECT 1 FROM product_info pi WHERE pi.project_id = projects.id AND pi.components <> '[]'::jsonb) AS has_product_info
     FROM projects WHERE id = $1 AND deleted_at IS NULL`, [id],
  )
  return rows[0] ? rowToProject(rows[0]) : null
}

/**
 * Same as `getProject` but does NOT filter out soft-deleted rows. Used only
 * by the detail GET route: someone who had this project open (or clicked a
 * "project deleted" notification) should still be able to see what it was —
 * read-only — rather than hitting a bare 404 that throws away all context.
 * Every mutation route keeps using `getProject`/`getProjectForUpdate` (which
 * DO filter), so a deleted project stays fully frozen either way.
 */
export async function getProjectIncludingDeleted(id) {
  const { rows } = await getPool().query(
    `SELECT ${PROJECT_COLUMNS}
       , ${deliveredByNameSql('projects')}
       , EXISTS(SELECT 1 FROM product_info pi WHERE pi.project_id = projects.id AND pi.components <> '[]'::jsonb) AS has_product_info
     FROM projects WHERE id = $1`, [id],
  )
  return rows[0] ? rowToProject(rows[0]) : null
}

/** Same shape, but as a single `client.query` argument for use inside `withTx`. */
export async function getProjectForUpdate(client, id) {
  const { rows } = await client.query(
    `SELECT ${PROJECT_COLUMNS}
       , ${deliveredByNameSql('projects')}
       , EXISTS(SELECT 1 FROM product_info pi WHERE pi.project_id = projects.id AND pi.components <> '[]'::jsonb) AS has_product_info
     FROM projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id],
  )
  return rows[0] ? rowToProject(rows[0]) : null
}

/**
 * One subtask's worth of page rows (migration 055 + 056), keyed by subtask_id
 * so a single follow-up query can splice them onto the subtask list. Returned
 * shape is exactly what the SPA's chip grid expects — `{ i, status, done_by,
 * done_by_name, done_at, rework_count, assigned_to, assigned_to_name,
 * assigned_at }` — already in page-index order. Exported so the page-edit
 * route can refetch a single subtask's pages after a PATCH without
 * re-running the full project subtask list.
 *
 * `assigned_to` (migration 056) is resolved at read time via the same LEFT
 * JOIN pattern `done_by` uses — the column itself stores the user id, and
 * the name comes from `users.name`. The grid uses assigned_to for the
 * chip's color (so every designer can see at a glance which pages are
 * theirs) and done_by for the tooltip's "shipped by" line.
 */
export async function loadSubtaskPages(client, subtaskIds) {
  if (!subtaskIds.length) return new Map()
  const { rows } = await client.query(
    `SELECT sp.subtask_id, sp.page_index, sp.status, sp.done_by, sp.done_at,
            sp.rework_count, sp.assigned_to, sp.assigned_at,
            u.name AS done_by_name,
            a.name AS assigned_to_name
       FROM subtask_pages sp
       LEFT JOIN users u ON u.id = sp.done_by
       LEFT JOIN users a ON a.id = sp.assigned_to
      WHERE sp.subtask_id = ANY($1::text[])
      ORDER BY sp.subtask_id, sp.page_index`,
    [subtaskIds],
  )
  const bySubtask = new Map()
  for (const r of rows) {
    if (!bySubtask.has(r.subtask_id)) bySubtask.set(r.subtask_id, [])
    bySubtask.get(r.subtask_id).push({
      i: r.page_index,
      status: r.status,
      done_by: r.done_by ?? null,
      done_by_name: r.done_by_name ?? null,
      done_at: r.done_at instanceof Date ? r.done_at.toISOString() : r.done_at,
      rework_count: r.rework_count,
      assigned_to: r.assigned_to ?? null,
      assigned_to_name: r.assigned_to_name ?? null,
      assigned_at: r.assigned_at instanceof Date ? r.assigned_at.toISOString() : r.assigned_at,
    })
  }
  return bySubtask
}

/**
 * Seed page rows for a newly created `kind='pages'` subtask. Idempotent —
 * uses ON CONFLICT DO NOTHING on (subtask_id, page_index), so calling it on
 * an already-seeded subtask is a no-op. A subtask without total_pages (or
 * with total_pages <= 0) gets no rows; the chip grid will render empty.
 */
export async function seedSubtaskPages(client, subtaskId, totalPages) {
  const n = Number(totalPages)
  if (!Number.isFinite(n) || n <= 0) return
  // generate_series is faster than N parameterised INSERTs and keeps the
  // statement plan-friendly. The conflict target matches the UNIQUE index.
  await client.query(
    `INSERT INTO subtask_pages (subtask_id, page_index, status)
     SELECT $1, g, 'pending'
       FROM generate_series(1, $2) AS g
     ON CONFLICT (subtask_id, page_index) DO NOTHING`,
    [subtaskId, n],
  )
}

/**
 * Trim a subtask's page rows down to `totalPages`. Rows past the new total
 * are deleted; rows inside the new range are untouched (their done state
 * survives a leader shrinking the book from 48 to 32 pages). Matches the
 * existing `pages_done = LEAST(pages_done, ...)` guard on bulk subtask save.
 */
export async function pruneSubtaskPages(client, subtaskId, totalPages) {
  await client.query(
    `DELETE FROM subtask_pages WHERE subtask_id = $1 AND page_index > $2`,
    [subtaskId, Number(totalPages) || 0],
  )
}

/**
 * Flip a single page's status. Validates the subtask is `kind='pages'` and
 * the page_index is within range, then writes status + done_by/done_at +
 * (for rework transitions) increments rework_count. Returns the updated row
 * so the route can splice it into the next GET without a re-read.
 *
 * Ownership rule mirrors the project subtask PATCH route: any project
 * assignee can mark a page done (designers split the work), but only the
 * actor who marked it done (or the team leader) can clear it back to
 * pending or mark it for rework. Kept on the hot path — every chip click
 * hits it — so the body is a single UPDATE.
 */
export async function setSubtaskPage(
  client,
  { subtaskId, pageIndex, status, actorId, actorName },
) {
  const { rows: subRows } = await client.query(
    `SELECT id, project_id, kind, total_pages FROM subtasks WHERE id = $1 FOR UPDATE`,
    [subtaskId],
  )
  const sub = subRows[0]
  if (!sub) return { error: 'not_found' }
  if (sub.kind !== 'pages') return { error: 'wrong_kind' }
  const total = Number(sub.total_pages ?? 0)
  if (!Number.isFinite(pageIndex) || pageIndex < 1 || pageIndex > total) {
    return { error: 'out_of_range' }
  }
  // The page row was seeded at subtask creation time, but if the row is
  // missing (e.g. leader lowered total_pages then raised it back) recreate
  // it on the fly so the click doesn't silently 404.
  const { rows: pageRows } = await client.query(
    `SELECT * FROM subtask_pages WHERE subtask_id = $1 AND page_index = $2 FOR UPDATE`,
    [subtaskId, pageIndex],
  )
  let page = pageRows[0]
  if (!page) {
    await client.query(
      `INSERT INTO subtask_pages (subtask_id, page_index, status) VALUES ($1, $2, 'pending')
         ON CONFLICT (subtask_id, page_index) DO NOTHING`,
      [subtaskId, pageIndex],
    )
    // Re-read so the ownership checks below see the freshly-inserted row.
    // Without this, `page` stays undefined and the `page && …` guards below
    // silently let a cross-author click through against a brand-new row.
    // Currently harmless — the inserted row is always `pending`, so the
    // `status === 'done'` ownership check can't fire — but a future change
    // to the default status would silently re-introduce the gap.
    const { rows: reRows } = await client.query(
      `SELECT * FROM subtask_pages WHERE subtask_id = $1 AND page_index = $2`,
      [subtaskId, pageIndex],
    )
    if (reRows[0]) page = reRows[0]
  }

  // Compute the new state in one UPDATE. done_by / done_at are stamped on
  // the done transition and cleared when going back to pending (rework is
  // a separate state — it keeps done_by/done_at so the team leader can see
  // who last shipped the page before it bounced).
  //
  // Capture `prevStatus` BEFORE the UPDATE so the route can tell whether
  // the click actually flipped state. A same-author redundant done click
  // passes the not_yours gate (the original finisher IS allowed to re-done
  // their own page), the UPDATE still runs and rewrites done_at, but the
  // route uses prevStatus to decide whether to write a history row — a
  // no-op should produce no timeline entry.
  const prevStatus = page?.status ?? 'pending'
  let reworkBump = 0
  let nextStatus = status
  if (status === 'done') {
    // Allow any assignment to drive a pending/rework page to done, but
    // refuse to overwrite someone else's done unless the caller is a team
    // leader (the leader override keeps the UI honest without a per-row
    // ownership column).
    if (page && page.status === 'done' && page.done_by && page.done_by !== actorId) {
      return { error: 'not_yours', page }
    }
  } else if (status === 'pending') {
    if (page && page.status === 'done' && page.done_by && page.done_by !== actorId) {
      return { error: 'not_yours', page }
    }
    nextStatus = 'pending'
  } else if (status === 'rework') {
    // Rework has the same ownership rule as `done`/`pending`: only the
    // original finisher (or the team leader, via the route's !isLeader
    // bypass) may flag a done page for rework. Without this check, any
    // project assignee could rewrite another designer's done page by
    // bouncing it through `rework → done`, which silently stole the
    // `done_by` attribution in bug #6's original report.
    //
    // A pending page has no finisher yet, so this check is a no-op for
    // that case — designers can still flag a never-finished page for
    // rework, which the original code also allowed.
    if (page && page.status === 'done' && page.done_by && page.done_by !== actorId) {
      return { error: 'not_yours', page }
    }
    reworkBump = 1
  } else {
    return { error: 'bad_status' }
  }

  const { rows: updated } = await client.query(
    `UPDATE subtask_pages
        SET status = $3,
            done_by = CASE WHEN $3 = 'done' THEN $4 ELSE NULL END,
            done_at = CASE WHEN $3 = 'done' THEN NOW() ELSE NULL END,
            rework_count = rework_count + $5,
            updated_at = NOW()
      WHERE subtask_id = $1 AND page_index = $2
      RETURNING subtask_id, page_index, status, done_by, done_at, rework_count`,
    [subtaskId, pageIndex, nextStatus, actorId ?? null, reworkBump],
  )

  // Sync the subtask-level counters (`pages_done`, `is_done`) so the project
  // progress bar tracks the chip grid. Counts rework as "not done" for the
  // purpose of `pages_done` — the leader wants to see "X/Y done" reflect
  // pages that are genuinely finished, not pages that are mid-rework.
  const { rows: countRows } = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'done')   AS done_count,
       COUNT(*) FILTER (WHERE status = 'rework') AS rework_count,
       COUNT(*)                                  AS total_count
       FROM subtask_pages WHERE subtask_id = $1`,
    [subtaskId],
  )
  const counts = countRows[0]
  const pagesDone = Number(counts.done_count)
  const reworkCount = Number(counts.rework_count)
  const isDone = counts.total_count > 0 && pagesDone === Number(counts.total_count)
  const { rows: subUpdated } = await client.query(
    `UPDATE subtasks
        SET pages_done = $2,
            is_done = $3,
            -- Mirror the existing PATCH /subtasks/:id convention: stamp
            -- done_at on the transition into done, clear it when leaving.
            done_at = CASE
                        WHEN $3 AND NOT is_done THEN NOW()
                        WHEN NOT $3 THEN NULL
                        ELSE done_at
                      END,
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, project_id, is_done, pages_done`,
    [subtaskId, pagesDone, isDone],
  )

  return { updated: updated[0], subtask: subUpdated[0], pagesDone, reworkCount, prevStatus }
}

/**
 * Assign (or un-assign) a single page on an "İç Sayfalar" subtask
 * (migration 056). The leader-only verb that drives both pre-allocation
 * ("split a 48-page book between Aylin and Rahşan before work starts")
 * and mid-flight reassignment ("move pages 5, 8, 12 from Aylin to
 * Rahşan after the demo bounced").
 *
 * Separate route from `setSubtaskPage` because the two operations are
 * orthogonal — a leader can reassign a page without touching its status,
 * and a designer can mark a page done without claiming it as their own.
 * Bundling them into one route would force every call to specify both,
 * which is wrong for the "just reassign" gesture.
 *
 * Returns the updated row + the resolved assignee name (joined live so
 * the UI doesn't have to re-SELECT).
 */
export async function assignSubtaskPage(
  client,
  { subtaskId, pageIndex, assignedTo, actorId },
) {
  const { rows: subRows } = await client.query(
    `SELECT id, project_id, kind, total_pages FROM subtasks WHERE id = $1 FOR UPDATE`,
    [subtaskId],
  )
  const sub = subRows[0]
  if (!sub) return { error: 'not_found' }
  if (sub.kind !== 'pages') return { error: 'wrong_kind' }
  const total = Number(sub.total_pages ?? 0)
  if (!Number.isFinite(pageIndex) || pageIndex < 1 || pageIndex > total) {
    return { error: 'out_of_range' }
  }
  // The page row may not exist yet (the leader is assigning pages before
  // any designer has touched them). Create a fresh row on the fly — same
  // re-seed-on-the-fly logic setSubtaskPage uses, just with assignment
  // instead of status. ON CONFLICT keeps it safe if another transaction
  // raced us to INSERT.
  await client.query(
    `INSERT INTO subtask_pages (subtask_id, page_index, status, assigned_to, assigned_at)
     VALUES ($1, $2, 'pending', $3, CASE WHEN $3 IS NULL THEN NULL ELSE NOW() END)
     ON CONFLICT (subtask_id, page_index) DO NOTHING`,
    [subtaskId, pageIndex, assignedTo ?? null],
  )
  // If the row already existed (most common case), the INSERT was a no-op
  // and we still need to UPDATE assigned_to + assigned_at. NULL means
  // "un-assign" — clear both columns so the chip grid falls back to the
  // grey "no owner" treatment.
  const { rows: updated } = await client.query(
    `UPDATE subtask_pages
        SET assigned_to = $3,
            assigned_at = CASE WHEN $3 IS NULL THEN NULL ELSE NOW() END,
            updated_at = NOW()
      WHERE subtask_id = $1 AND page_index = $2
      RETURNING subtask_id, page_index, status, done_by, done_at, rework_count,
                assigned_to, assigned_at`,
    [subtaskId, pageIndex, assignedTo ?? null],
  )
  // Resolve the assignee name live so the response carries it without a
  // second SELECT. Same LEFT JOIN shape as loadSubtaskPages.
  let assignedToName = null
  if (updated[0]?.assigned_to) {
    const { rows: uRows } = await client.query(
      `SELECT name FROM users WHERE id = $1`,
      [updated[0].assigned_to],
    )
    assignedToName = uRows[0]?.name ?? null
  }
  return {
    page: {
      ...updated[0],
      done_by_name: null,
      assigned_to_name: assignedToName,
    },
  }
}

export async function listProjectSubtasks(client, projectId) {
  // LEFT JOIN users so each row carries `assigned_name`. Without this the
  // ProjectDetail UI can show "Kapak → u-1bMgmt0PcKOpGdvC" (raw id) because
  // it has no way to resolve the user name client-side without a separate
  // /api/users round trip per row.
  const { rows } = await client.query(
    `SELECT s.id, s.project_id, s.title, s.kind, s.is_done, s.total_pages, s.pages_done,
            s.total_stickers, s.stickers_done, s.assigned_to, s.done_at,
            s.needs_revize, s.position, s.created_at, s.updated_at,
            u.name AS assigned_name
       FROM subtasks s
       LEFT JOIN users u ON u.id = s.assigned_to
       WHERE s.project_id = $1
       -- position is the team leader's explicit order (migration 027);
       -- created_at is the tiebreaker for rows written before it existed.
       ORDER BY s.position, s.created_at`,
    [projectId],
  )
  // migration 055 — splice the page grid onto every kind='pages' subtask so
  // the chip list comes back in one round trip. Without this the SPA would
  // have to fire one /subtasks/:id/pages GET per pages subtask on every load.
  const pagesBySubtask = await loadSubtaskPages(
    client,
    rows.filter((s) => s.kind === 'pages').map((s) => s.id),
  )
  return rows.map((s) => (
    s.kind === 'pages' ? { ...s, pages: pagesBySubtask.get(s.id) ?? [] } : s
  ))
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
            h.pass_number, h.done_by, h.note, h.demo_id, h.created_at,
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
  // Demo "received" gate — set at demo_onay by a designer/leader, reset when a
  // fresh demo is delivered. Blocks the demo approve until true.
  'demo_received',
  'demo_received_by',
  'demo_received_at',
  // Ozalit "received" gate — the same rule one leg later: set at ozalit_onay,
  // reset when the matbaa delivers a fresh proof, blocks the ozalit approve
  // until true (migration 035).
  'ozalit_received',
  'ozalit_received_by',
  'ozalit_received_at',
  // Baskı Onay Formu dual-approval (migration 045): one team leader prepares
  // (sets these three), a DIFFERENT team leader approves — computeApproval's
  // baski_onay branch refuses the same actor unless no other active leader
  // exists. Reset once the project actually advances to Üretime Hazır.
  'baski_onay_prepared',
  'baski_onay_prepared_by',
  'baski_onay_prepared_by_name',
  'baski_onay_prepared_at',
  // Who/when the matbaa delivered the current demo round. Set by
  // computeDemoTeslimAdvance, nulled by a resend or "Teslim Alınamadı".
  // `demo_delivered_by` is the id everything now reads through; the _name
  // stays writable on purpose as the fallback snapshot described on
  // `deliveredByNameSql` — it is no longer what gets read back.
  'demo_delivered_at',
  'demo_delivered_by',
  'demo_delivered_by_name',
  // ozalit_teslim two-step + reject-to-matbaa re-delivery lock. Set by the
  // ozalit transitions (computeOzalitTeslimAdvance) and computeRejection.
  'ozalit_requested',
  'reject_target',
  // Which kind of rejection sent the project back to Tasarım. computeAdvance
  // reads last_reject_type to route an ozalit-revision resubmit to ozalit_teslim.
  'last_reject_type',
  'last_reject_target',
  // Multi-party ozalit approval: array of { id, role, name, at } approvers.
  'ozalit_approvals',
  // Matbaa "Başladım" gate (migration 048): flag-only marker the printer sets
  // once physical work begins. While false, the leader/assigned designer can
  // cancel or edit the request freely; reset on every fresh printer round.
  'demo_started',
  'demo_started_at',
  'demo_started_by',
  'demo_started_by_name',
  'ozalit_started',
  'ozalit_started_at',
  'ozalit_started_by',
  'ozalit_started_by_name',
  // Pending change-request ledger (migration 048): presence of
  // `*_change_requested_at` IS the pending flag, no separate boolean. Set by
  // computeDemoChangeRequest/computeOzalitChangeRequest, cleared by the
  // matching accept/decline transition.
  'demo_change_requested_at',
  'demo_change_requested_by',
  'demo_change_requested_by_name',
  'demo_change_requested_note',
  'ozalit_change_requested_at',
  'ozalit_change_requested_by',
  'ozalit_change_requested_by_name',
  'ozalit_change_requested_note',
  // "Fix owed" gate (migration 049): set true only by an accepted change
  // request, cleared by the matching edit-notify submission or an outright
  // cancel. While true, computeDemoStart/computeOzalitStart refuse to
  // re-lock the round.
  'demo_fix_pending',
  'ozalit_fix_pending',
  // Ekran Demo Onayı pending-request ledger (migration 050): presence of
  // `ekran_demo_requested_at` IS the pending flag, same convention as
  // `demo_change_requested_at`. Set by computeEkranDemoRequest, cleared by
  // computeEkranDemoApprove/Reject.
  'ekran_demo_requested_at',
  'ekran_demo_requested_by',
  'ekran_demo_requested_by_name',
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
    // The routes hand this row straight back to the SPA, so the derived name
    // has to be resolved here too — otherwise the response to the very
    // request that renamed things would still carry the stale snapshot.
    `UPDATE projects SET ${setSql}, updated_at = NOW() WHERE id = $1
     RETURNING ${PROJECT_COLUMNS}, ${deliveredByNameSql('projects')}`,
    [id, ...values],
  )
  return rows[0] ? rowToProject(rows[0]) : null
}

// Soft-delete: the row stays put (and out of `listProjects`/`getProject`)
// so a misclick is recoverable from the "Silinen Projeler" page instead of
// being gone for good. Takes a tx `client` (not the pool) so the route can
// commit it atomically with the "project deleted" notification fan-out.
export async function deleteProject(client, id, actor) {
  await client.query(
    'UPDATE projects SET deleted_at = NOW(), deleted_by = $2, deleted_by_name = $3 WHERE id = $1',
    [id, actor?.id ?? null, actor?.name ?? null],
  )
}

/**
 * "Kaldır" / "Geri Al" — delist a product from the Ürünler catalog, or put it
 * back (migration 033).
 *
 * Deliberately NOT a soft delete: the project keeps its stage, history,
 * assignees and dashboard presence, and only drops out of the sipariş catalog.
 * The stamp columns are cleared on re-listing so "kaldıran / tarih" always
 * describes the CURRENT hidden state rather than the last one.
 *
 * Returns the updated project, or null when the id doesn't exist (or is
 * soft-deleted — a deleted project isn't in the catalog to begin with).
 */
export async function setProjectCatalogHidden(client, id, hidden, actor) {
  const { rows } = await client.query(
    `UPDATE projects
        SET catalog_hidden = $2,
            catalog_hidden_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
            catalog_hidden_by = CASE WHEN $2 THEN $3::text ELSE NULL END,
            updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING ${PROJECT_COLUMNS}, ${deliveredByNameSql('projects')}`,
    [id, hidden, actor?.id ?? null],
  )
  return rows[0] ? rowToProject(rows[0]) : null
}

export async function listDeletedProjects() {
  const { rows } = await getPool().query(
    `SELECT p.id, p.title, p.type, p.stage, p.target_month, p.created_at,
            p.deleted_at, p.deleted_by, p.deleted_by_name,
            a.name AS assignee_name
       FROM projects p
       LEFT JOIN users a ON a.id = p.assigned_to
      WHERE p.deleted_at IS NOT NULL
      ORDER BY p.deleted_at DESC, p.id`,
  )
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    stage: r.stage,
    target_month: r.target_month,
    assigned_name: r.assignee_name ?? null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    deleted_at: r.deleted_at instanceof Date ? r.deleted_at.toISOString() : r.deleted_at,
    deleted_by: r.deleted_by,
    deleted_by_name: r.deleted_by_name,
  }))
}

export async function restoreProject(id) {
  const { rows } = await getPool().query(
    `UPDATE projects
        SET deleted_at = NULL, deleted_by = NULL, deleted_by_name = NULL
      WHERE id = $1 AND deleted_at IS NOT NULL
      RETURNING ${PROJECT_COLUMNS}, ${deliveredByNameSql('projects')}`,
    [id],
  )
  return rows[0] ? rowToProject(rows[0]) : null
}

export async function insertHistory(client, entry) {
  await client.query(
    `INSERT INTO stage_history
       (project_id, from_stage, to_stage, action, event, reason, reject_target, pass_number, done_by, note, demo_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
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
      // The spec-sheet snapshot this row produced, when it produced one
      // (migration 052) — the only way to tell two corrections of the same
      // round apart, since both share an attempt slot.
      entry.demo_id ?? null,
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

/**
 * Re-evaluate pending ozalit approvals after the set of active team leaders
 * changes (e.g. a leader was deactivated). The ozalit rule is "every ACTIVE
 * team leader + every assigned designer must approve"; that required set only
 * gets re-checked when someone clicks Approve. So if the only outstanding
 * approval was a leader who just got deactivated, the project would otherwise
 * sit at ozalit_onay forever. This advances any such project to Baskı Onayı
 * (migration 044) — same destination as a normal completed round; the final
 * print approval is still owed there before Üretime Hazır.
 *
 * Call it AFTER the deactivation is committed so the active-leaders query
 * excludes the deactivated user. `actor` is stamped on the history row.
 * Returns the number of projects advanced.
 */
/**
 * Insert one demo/ozalit form snapshot.
 *
 * Shared by `POST /demos` and the demo/ozalit edit-notify routes so a
 * correction to an already-sent sheet is written inside the same transaction
 * that authorizes it. Takes a `client` (never the pool) for exactly that
 * reason — if the caller's guard throws afterwards, the row rolls back with
 * it. See the "Başladım" guard in routes/demos.js for what goes wrong when
 * the write and the guard live in separate requests.
 */
export async function insertDemoSnapshot(client, { project_id, order_id = null, kind, payload, attempt, created_by }) {
  // demos.id is TEXT PRIMARY KEY with no default — mint a `d-<nanoid>` so the
  // INSERT satisfies NOT NULL. The prefix keeps it visually distinct from
  // user (u-…) / project (p-…) ids.
  //
  // order_id is NULL for a project's own demo/ozalit round and set for a
  // sipariş's (migration 053). project_id is filled either way — a sipariş
  // sheet still belongs to a product — so every read must scope on BOTH or a
  // sipariş round shows up as the project's latest sheet.
  const { rows } = await client.query(
    `INSERT INTO demos (id, project_id, order_id, kind, payload, attempt, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, project_id, order_id, kind, payload, attempt, created_by, created_at`,
    [`d-${nanoid(16)}`, project_id, order_id, kind, payload, attempt, created_by],
  )
  return rows[0]
}

export async function reconcileOzalitApprovals(actor) {
  const { rows: leaderRows } = await getPool().query(
    "SELECT id FROM users WHERE role = 'team_leader' AND is_active = TRUE",
  )
  const activeLeaderIds = leaderRows.map((r) => r.id)

  const { rows: candidates } = await getPool().query(
    `SELECT id FROM projects
      WHERE stage = 'ozalit_onay'
        AND jsonb_array_length(COALESCE(ozalit_approvals, '[]'::jsonb)) > 0`,
  )

  let advanced = 0
  for (const { id } of candidates) {
    // eslint-disable-next-line no-await-in-loop
    await withTx(async (client) => {
      const project = await getProjectForUpdate(client, id)
      if (!project || project.stage !== 'ozalit_onay') return
      // Can't enter production below 100% — leave it (shouldn't happen at
      // ozalit_onay, but stay safe).
      if ((project.progress ?? 0) < 100) return

      const assignees = await loadProjectAssignees(client, project)
      const designerIds = assignees.map((a) => a.id)
      const required = [...new Set([...activeLeaderIds, ...designerIds])]
      const approvals = Array.isArray(project.ozalit_approvals) ? project.ozalit_approvals : []
      const approvedIds = new Set(approvals.map((a) => a.id))
      const complete = required.length > 0 && required.every((rid) => approvedIds.has(rid))
      if (!complete) return

      await patchProject(client, id, {
        stage: 'baski_onay',
        version: (project.version ?? 0) + 1,
        ozalit_approvals: JSON.stringify([]),
        ozalit_leader_approved: false,
        ozalit_leader_approved_by: null,
        ozalit_leader_approved_at: null,
        ozalit_designer_approvals: JSON.stringify([]),
      })
      await logHistory(
        client,
        {
          project_id: id,
          from_stage: 'ozalit_onay',
          to_stage: 'baski_onay',
          action: 'approve',
          note: 'Ozalit onaylandı, baskı onayına gönderildi (bekleyen lider devre dışı bırakıldı)',
        },
        actor,
      )
      // Ürün Bilgileri capture is NOT done here — the project no longer enters
      // production directly from this path, it lands on baski_onay like any
      // other completed ozalit round. Capture happens once a team leader gives
      // the final Baskı Onayı (routes/projects.js's approve route).
      advanced += 1
    })
  }
  return advanced
}

/**
 * Insert a project.
 *
 * `stage`, `progress` and `origin` are parameterised rather than hardcoded so
 * the legacy/backlist import (`POST /api/projects/import`) can create a row
 * that already sits at a finished stage. The defaults reproduce the normal
 * create path exactly — a new project starts at Tasarım, 0% done, provenance
 * 'pipeline' — so every pre-existing caller behaves identically.
 *
 * `progress` matters more than it looks for legacy rows: every orderable stage
 * is in STAGES_REQUIRING_FULL_PROGRESS, and the client colours cards off
 * progress, so a finished book imported at 0% renders as overdue/red.
 */
export async function insertProject(client, fields) {
  // The projects table has `id TEXT PRIMARY KEY` with no default — we
  // mint a `p-<nanoid>` here so the INSERT doesn't violate the not-null
  // constraint. The prefix keeps it visually distinct from user (u-…)
  // and order/handover ids, and nanoid(16) gives plenty of entropy for
  // a small-to-medium team.
  //
  // A caller-supplied `id` is honoured — the legacy import reuses the
  // REÇETE.xlsx seed id (`p-x1`) so the Ürün Bilgileri orphan row converts
  // in place instead of appearing twice. The route restricts which ids may
  // be passed; do NOT widen that without re-reading why.
  const projectId = fields.id ?? `p-${nanoid(16)}`
  const { rows } = await client.query(
    `INSERT INTO projects
       (id, title, type, stage, assigned_to, created_by, target_month,
        pass_number, pass_kind, progress, origin, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10, NOW(), NOW())
     RETURNING ${PROJECT_COLUMNS}, ${deliveredByNameSql('projects')}`,
    [
      projectId,
      fields.title,
      fields.type,
      fields.stage ?? 'tasarim',
      fields.assigned_to ?? null,
      fields.created_by ?? null,
      fields.target_month ?? null,
      fields.pass_kind ?? 'first_edition',
      fields.progress ?? 0,
      fields.origin ?? 'pipeline',
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
    demo_received: r.demo_received ?? false,
    demo_received_by: r.demo_received_by ?? null,
    demo_received_at: r.demo_received_at instanceof Date
      ? r.demo_received_at.toISOString()
      : r.demo_received_at,
    ozalit_received: r.ozalit_received ?? false,
    ozalit_received_by: r.ozalit_received_by ?? null,
    ozalit_received_at: r.ozalit_received_at instanceof Date
      ? r.ozalit_received_at.toISOString()
      : r.ozalit_received_at,
    // Baskı Onay Formu dual-approval (migration 045): one team leader
    // prepares the form, a DIFFERENT one approves it. `_by` is a user id
    // (not just a name) so computeApproval can check "is the approver the
    // same person who prepared it".
    baski_onay_prepared: r.baski_onay_prepared ?? false,
    baski_onay_prepared_by: r.baski_onay_prepared_by ?? null,
    baski_onay_prepared_by_name: r.baski_onay_prepared_by_name ?? null,
    baski_onay_prepared_at: r.baski_onay_prepared_at instanceof Date
      ? r.baski_onay_prepared_at.toISOString()
      : r.baski_onay_prepared_at,
    demo_delivered_at: r.demo_delivered_at instanceof Date
      ? r.demo_delivered_at.toISOString()
      : r.demo_delivered_at,
    demo_delivered_by: r.demo_delivered_by ?? null,
    demo_delivered_by_name: r.demo_delivered_by_name ?? null,
    ozalit_requested: r.ozalit_requested ?? false,
    reject_target: r.reject_target ?? null,
    last_reject_type: r.last_reject_type ?? null,
    last_reject_target: r.last_reject_target ?? null,
    ozalit_approvals: r.ozalit_approvals ?? [],
    // Matbaa "Başladım" gate + pending change-request ledger (migration 048).
    demo_started: r.demo_started ?? false,
    demo_started_at: r.demo_started_at instanceof Date
      ? r.demo_started_at.toISOString()
      : r.demo_started_at,
    demo_started_by: r.demo_started_by ?? null,
    demo_started_by_name: r.demo_started_by_name ?? null,
    demo_change_requested_at: r.demo_change_requested_at instanceof Date
      ? r.demo_change_requested_at.toISOString()
      : r.demo_change_requested_at,
    demo_change_requested_by: r.demo_change_requested_by ?? null,
    demo_change_requested_by_name: r.demo_change_requested_by_name ?? null,
    demo_change_requested_note: r.demo_change_requested_note ?? null,
    demo_fix_pending: r.demo_fix_pending ?? false,
    ozalit_started: r.ozalit_started ?? false,
    ozalit_started_at: r.ozalit_started_at instanceof Date
      ? r.ozalit_started_at.toISOString()
      : r.ozalit_started_at,
    ozalit_started_by: r.ozalit_started_by ?? null,
    ozalit_started_by_name: r.ozalit_started_by_name ?? null,
    ozalit_change_requested_at: r.ozalit_change_requested_at instanceof Date
      ? r.ozalit_change_requested_at.toISOString()
      : r.ozalit_change_requested_at,
    ozalit_change_requested_by: r.ozalit_change_requested_by ?? null,
    ozalit_change_requested_by_name: r.ozalit_change_requested_by_name ?? null,
    ozalit_change_requested_note: r.ozalit_change_requested_note ?? null,
    ozalit_fix_pending: r.ozalit_fix_pending ?? false,
    // Ekran Demo Onayı pending-request ledger (migration 050).
    ekran_demo_requested_at: r.ekran_demo_requested_at instanceof Date
      ? r.ekran_demo_requested_at.toISOString()
      : r.ekran_demo_requested_at,
    ekran_demo_requested_by: r.ekran_demo_requested_by ?? null,
    ekran_demo_requested_by_name: r.ekran_demo_requested_by_name ?? null,
    has_product_info: r.has_product_info ?? false,
    // 'pipeline' | 'legacy'. The client's projects store filters `legacy` out of
    // every pipeline view (Kanban, Tüm Projeler, counts) — see migration 031.
    origin: r.origin ?? 'pipeline',
    // Delisted from the Ürünler catalog by the team leader (migration 033).
    // The project is otherwise untouched — this only hides it from Sales.
    catalog_hidden: r.catalog_hidden ?? false,
    catalog_hidden_at: r.catalog_hidden_at instanceof Date
      ? r.catalog_hidden_at.toISOString()
      : r.catalog_hidden_at ?? null,
    catalog_hidden_by: r.catalog_hidden_by ?? null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    deleted_at: r.deleted_at instanceof Date ? r.deleted_at.toISOString() : r.deleted_at,
    deleted_by: r.deleted_by ?? null,
    deleted_by_name: r.deleted_by_name ?? null,
  }
}
