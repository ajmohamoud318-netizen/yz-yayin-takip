/**
 * Subtask persistence: thin SQL wrapper for the `subtasks` and
 * `subtask_pages` tables. Designed for use from route handlers and
 * service entry points inside `withTx`.
 *
 * Sibling to `project-repository.js` — that file owns the `projects` /
 * `stage_history` / `demos` tables; this one owns the subtask-level
 * CRUD. `loadProjectAssignees` (which reads from `subtasks` to
 * resolve the people assigned to a project) stays in `project-repository.js`
 * because it's a project-level read, not a subtask-level CRUD — moving it
 * would scatter the project-aggregate reads across two files.
 *
 * Returns plain JS objects shaped for the SPA. Page rows are returned
 * already in page-index order with `assigned_to_name` resolved live
 * (so the chip grid never has to round-trip for user names).
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
 *
 * `defaultAssignedTo` is stamped on the INSERT path only — new rows pick up
 * the planned owner, existing rows keep whatever they had. Passing a non-null
 * value here is how POST /projects and PUT /projects/:id/subtasks propagate
 * the subtask-level `assigned_to` down to the per-page grid at create/edit
 * time, so the chip grid's "owner pip" renders the right color from the
 * first paint instead of every pending chip looking orphaned.
 *
 * `assigned_at` mirrors the convention in assignSubtaskPage: NOW() when an
 * owner is being stamped, NULL when no owner — so the chip-grid tooltip can
 * surface "X tarafından atandı" only when there's actually a name attached.
 * `$3::text` is cast explicitly because `assigned_to` is a nullable TEXT
 * column; without the cast pg can refuse the plan with 42P08 the same way it
 * does in assignSubtaskPage.
 */
export async function seedSubtaskPages(client, subtaskId, totalPages, defaultAssignedTo = null) {
  const n = Number(totalPages)
  if (!Number.isFinite(n) || n <= 0) return
  // generate_series is faster than N parameterised INSERTs and keeps the
  // statement plan-friendly. The conflict target matches the UNIQUE index.
  await client.query(
    `INSERT INTO subtask_pages (subtask_id, page_index, status, assigned_to, assigned_at)
     SELECT $1, g, 'pending', $3::text, CASE WHEN $3::text IS NULL THEN NULL ELSE NOW() END
       FROM generate_series(1, $2) AS g
     ON CONFLICT (subtask_id, page_index) DO NOTHING`,
    [subtaskId, n, defaultAssignedTo ?? null],
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
     VALUES ($1, $2, 'pending', $3::text, CASE WHEN $3::text IS NULL THEN NULL ELSE NOW() END)
     ON CONFLICT (subtask_id, page_index) DO NOTHING`,
    [subtaskId, pageIndex, assignedTo ?? null],
  )
  // If the row already existed (most common case), the INSERT was a no-op
  // and we still need to UPDATE assigned_to + assigned_at. NULL means
  // "un-assign" — clear both columns so the chip grid falls back to the
  // grey "no owner" treatment.
  const { rows: updated } = await client.query(
    `UPDATE subtask_pages
        SET assigned_to = $3::text,
            assigned_at = CASE WHEN $3::text IS NULL THEN NULL ELSE NOW() END,
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

/**
 * Bulk re-stamp `assigned_to` for every non-done page in a subtask. Called
 * by the subtask-list edit route when the team leader changes a
 * `kind='pages'` subtask's `assigned_to` mid-flight ("Aylin was on this, now
 * Rahşan is"), so the chip grid's owner pip + colour legend stay in sync
 * with the subtask-level owner instead of stranding every pending chip on
 * the original designer's colour.
 *
 * Done rows are deliberately skipped: `done_by` is the audit trail for who
 * actually shipped the page, and overwriting the planned owner of a page
 * that's already shipped would visually re-attribute work that was done by
 * someone else. The two signals (`assigned_to` = planned, `done_by` =
 * shipped) intentionally diverge on a mid-flight reassignment, exactly the
 * split migration 056 documents.
 *
 * The `IS DISTINCT FROM` guard makes the UPDATE a no-op when the planned
 * owner didn't actually change — the route layer already short-circuits
 * before calling us, but the SQL guard is the second line of defence so a
 * stray call (e.g. on a rename-only save) can't quietly re-stamp 200 rows.
 *
 * `$2::text` is cast for the same reason as assignSubtaskPage: nullable
 * TEXT column, the planner needs the type to be unambiguous even though
 * here the parameter only appears in one assignment.
 */
export async function resyncSubtaskPageAssignments(client, subtaskId, newAssignedTo) {
  await client.query(
    `UPDATE subtask_pages
        SET assigned_to = $2::text,
            assigned_at = CASE WHEN $2::text IS NULL THEN NULL ELSE NOW() END,
            updated_at = NOW()
      WHERE subtask_id = $1
        AND status <> 'done'
        AND assigned_to IS DISTINCT FROM $2::text`,
    [subtaskId, newAssignedTo ?? null],
  )
}

/**
 * List a project's subtasks with their per-page grids spliced on.
 *
 * Returns an array of subtask rows; rows with `kind='pages'` carry a
 * `pages: [{ i, status, ... }, ...]` array already spliced via the
 * internal `loadSubtaskPages` call, so the SPA never has to round-trip
 * for the chip grid.
 *
 * Lives here (not in `project-repository.js`) because the return shape
 * is subtask-shaped: `loadSubtaskPages` is a subtask-pages concern, and
 * the subtask list is the natural pairing for it. The project-level
 * `getProjectDetail` consumer reaches this through
 * `project-repository.js`'s barrel re-export.
 */
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