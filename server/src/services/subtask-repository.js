/**
 * Subtask persistence: thin SQL wrapper for the `subtasks` and
 * `subtask_designer_counts` tables. Designed for use from route handlers
 * and service entry points inside `withTx`.
 *
 * Sibling to `project-repository.js` — that file owns the `projects` /
 * `stage_history` / `demos` tables; this one owns the subtask-level
 * CRUD and the per-designer page-count rows. `loadProjectAssignees`
 * (which reads from `subtasks` to resolve the people assigned to a
 * project) stays in `project-repository.js` because it's a
 * project-level read, not a subtask-level CRUD — moving it would
 * scatter the project-aggregate reads across two files.
 *
 * Returns plain JS objects shaped for the SPA.
 *
 * Page-grid model: migration 067 — the chip-by-chip `subtask_pages`
 * table is gone. The "İç Sayfalar" subtask now tracks work as one row
 * per assigned designer (`subtask_designer_counts`) with the count
 * the designer typed into their UI input. `subtasks.pages_done` and
 * `subtasks.is_done` are kept as concrete columns maintained by a
 * trigger (recomputed on every write to `subtask_designer_counts`) so
 * `progressFor` and the progress bar keep reading them with no join.
 */

const DESIGNER_COUNTS_BATCH_LIMIT = 256

/**
 * Per-designer page count rows for one subtask, keyed by `subtask_id`,
 * each entry shaped `{ designer_id, designer_name, pages_done,
 * updated_at }`. Empty array when the subtask has no designer slots
 * yet (the leader hasn't assigned anyone, or the subtask is kind≠'pages').
 */
export async function loadSubtaskDesignerCounts(client, subtaskIds) {
  if (!subtaskIds.length) return new Map()
  const { rows } = await client.query(
    `SELECT sdc.subtask_id, sdc.designer_id, sdc.pages_done, sdc.updated_at,
            u.name AS designer_name
       FROM subtask_designer_counts sdc
       LEFT JOIN users u ON u.id = sdc.designer_id
      WHERE sdc.subtask_id = ANY($1::text[])
      ORDER BY sdc.subtask_id, u.name NULLS LAST, sdc.designer_id`,
    [subtaskIds],
  )
  const bySubtask = new Map()
  for (const r of rows) {
    if (!bySubtask.has(r.subtask_id)) bySubtask.set(r.subtask_id, [])
    bySubtask.get(r.subtask_id).push({
      designer_id: r.designer_id,
      designer_name: r.designer_name ?? null,
      pages_done: r.pages_done,
      updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    })
  }
  return bySubtask
}

/**
 * Upsert a batch of per-designer page counts in one statement. Each entry
 * is `{ designer_id, pages_done }`; the `(subtask_id, designer_id)`
 * primary key guarantees one row per designer per subtask. The trigger
 * on `subtask_designer_counts` keeps `subtasks.pages_done` and
 * `subtasks.is_done` in sync.
 *
 * Idempotent: an entry whose `pages_done` matches what's already on the
 * row triggers the recompute function but writes nothing observable.
 * Entries with a non-positive `pages_done` are persisted as 0 (the
 * column CHECK rejects negatives — the route clamps ahead of this
 * call so this branch is the escape hatch for a buggy caller).
 *
 * Returns the post-write state for every upserted row, joined against
 * `users` so the response can render assignee names without a second
 * round-trip.
 *
 * `counts` is empty → no-op SELECT (still returns []).
 */
export async function setSubtaskDesignerCounts(client, { subtaskId, counts }) {
  if (!subtaskId || !Array.isArray(counts) || counts.length === 0) return []
  if (counts.length > DESIGNER_COUNTS_BATCH_LIMIT) {
    throw new Error(`too many counts in one batch: ${counts.length} > ${DESIGNER_COUNTS_BATCH_LIMIT}`)
  }
  // Two parallel arrays so the UPSERT can use unnest() instead of a
  // per-entry round-trip — same pattern the `setSubtaskPage`-on-steroids
  // would have needed anyway. unnest() with parallel arrays is faster
  // than a VALUES list for the planner and matches the convention in
  // services/order-repository.js.
  const designerIds = counts.map((c) => c.designer_id)
  const pagesDones = counts.map((c) => Math.max(0, Math.floor(Number(c.pages_done) || 0)))
  const { rows } = await client.query(
    `WITH input (designer_id, pages_done) AS (
       SELECT designer_id::text, pages_done::int
         FROM unnest($2::text[]) WITH ORDINALITY AS d(designer_id, ord)
         JOIN unnest($3::int[]) WITH ORDINALITY AS p(pages_done, ord)
           USING (ord)
     )
     INSERT INTO subtask_designer_counts (subtask_id, designer_id, pages_done, updated_at)
     SELECT $1::text, designer_id, pages_done, NOW()
       FROM input
     ON CONFLICT (subtask_id, designer_id) DO UPDATE
        SET pages_done = EXCLUDED.pages_done,
            updated_at = NOW()
     RETURNING subtask_id, designer_id, pages_done, updated_at`,
    [subtaskId, designerIds, pagesDones],
  )
  return rows
}

/**
 * Read one subtask's per-designer page counts in stable insertion order.
 * Convenience wrapper around `loadSubtaskDesignerCounts` for routes that
 * just saved counts and want to echo them back.
 */
export async function getSubtaskDesignerCounts(client, subtaskId) {
  const map = await loadSubtaskDesignerCounts(client, [subtaskId])
  return map.get(subtaskId) ?? []
}

/**
 * Sum the per-designer counts and clamp against `subtasks.total_pages`,
 * then update the subtask's `pages_done` and `is_done` columns. Called
 * explicitly by routes that need the immediate post-write values
 * without waiting for the trigger (the trigger eventually agrees, but
 * the route wants them in the same response to avoid a follow-up
 * SELECT).
 *
 * `RETURNING` carries the values that were written so the caller can
 * skip the round-trip.
 */
export async function refreshSubtaskPagesCounters(client, subtaskId) {
  const { rows } = await client.query(
    `WITH s AS (
       SELECT id, total_pages FROM subtasks WHERE id = $1
     ),
     agg AS (
       SELECT COALESCE(SUM(pages_done), 0)::int AS sum_done
         FROM subtask_designer_counts
        WHERE subtask_id = $1
     )
     UPDATE subtasks t
        SET pages_done = LEAST(agg.sum_done, s.total_pages),
            is_done    = (s.total_pages > 0 AND agg.sum_done >= s.total_pages),
            updated_at = NOW()
       FROM s, agg
      WHERE t.id = s.id
      RETURNING t.id, t.total_pages, t.pages_done, t.is_done, t.updated_at`,
    [subtaskId],
  )
  return rows[0] ?? null
}

/**
 * List a project's subtasks with their per-designer counts spliced on.
 *
 * Returns an array of subtask rows; rows with `kind='pages'` carry a
 * `designer_counts: [{ designer_id, designer_name, pages_done,
 * updated_at }, ...]` array. The chip grid's `pages: [{i, status, …}]`
 * shape is gone; `designer_counts` is the per-designer equivalent and
 * drives the new number-input UI.
 *
 * Lives here (not in `project-repository.js`) because the return shape
 * is subtask-shaped: `loadSubtaskDesignerCounts` is a
 * subtask-level read, and the subtask list is the natural pairing for
 * it. The project-level `getProjectDetail` consumer reaches this
 * through `project-repository.js`'s barrel re-export.
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
  // migration 067 — splice the per-designer page counts onto every
  // kind='pages' subtask so the new number-input UI reads from the same
  // payload as the row card / progress bar (no follow-up GET).
  const countsBySubtask = await loadSubtaskDesignerCounts(
    client,
    rows.filter((s) => s.kind === 'pages').map((s) => s.id),
  )
  return rows.map((s) => (
    s.kind === 'pages'
      ? { ...s, designer_counts: countsBySubtask.get(s.id) ?? [] }
      : s
  ))
}
