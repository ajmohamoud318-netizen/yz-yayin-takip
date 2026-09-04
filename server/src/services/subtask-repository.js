/**
 * Subtask persistence: thin SQL wrapper for the `subtasks` and
 * `subtask_designer_batches` tables. Designed for use from route handlers
 * and service entry points inside `withTx`.
 *
 * Sibling to `project-repository.js` — that file owns the `projects` /
 * `stage_history` / `demos` tables; this one owns the subtask-level
 * CRUD and the per-designer batch rows. `loadProjectAssignees`
 * (which reads from `subtasks` to resolve the people assigned to a
 * project) stays in `project-repository.js` because it's a
 * project-level read, not a subtask-level CRUD — moving it would
 * scatter the project-aggregate reads across two files.
 *
 * Returns plain JS objects shaped for the SPA. Batch rows carry the
 * designer name resolved live (LEFT JOIN users) plus a denormalised
 * `redone_by_name` snapshot stamped at write time, so the list-page
 * render doesn't have to round-trip for redone-by display.
 *
 * Page-grid model: migration 067 — chip-by-chip `subtask_pages` is
 * gone. The "İç Sayfalar" subtask now tracks work as one row per
 * "I shipped N pages in this session" — `subtask_designer_batches` —
 * and the running total `subtasks.pages_done` is the SUM of every
 * row's `pages`, kept in sync by a trigger
 * (`recompute_subtask_pages_counter`). `is_done` flips to TRUE
 * automatically when the sum meets or exceeds `total_pages`.
 *
 * The previous "set pages_done = N" round-trip (PATCH
 * /subtasks/:id/designer-counts) was destructive — typing "2" then
 * later "3" replaced the 2 with a 3 and the day's first batch
 * silently vanished from the audit. The batch shape preserves the
 * timeline and lets a designer run "Yeniden Çalıştım" against a
 * specific saved session.
 */

const DESIGNER_BATCH_LIMIT = 256

/**
 * Per-designer session log for one subtask, keyed by `subtask_id`,
 * each entry shaped
 * `{ id, designer_id, designer_name, pages, created_at, redone_at,
 *   redone_by, redone_by_name }`. Newest first.
 *
 * Empty array when the subtask has no batches yet (the leader hasn't
 * shipped any pages yet, or the migration's backfill didn't run because
 * the subtask had `pages_done = 0` at migration time). The SPA renders
 * an empty-state hint in that case ("Henüz sayfa eklenmedi").
 */
export async function loadSubtaskDesignerBatches(client, subtaskIds) {
  if (!subtaskIds.length) return new Map()
  const { rows } = await client.query(
    `SELECT sdb.id, sdb.subtask_id, sdb.designer_id, sdb.pages, sdb.created_at,
            sdb.redone_at, sdb.redone_by, sdb.redone_by_name,
            u.name AS designer_name,
            r.name AS redone_by_name_live
       FROM subtask_designer_batches sdb
       LEFT JOIN users u ON u.id = sdb.designer_id
       LEFT JOIN users r ON r.id = sdb.redone_by
      WHERE sdb.subtask_id = ANY($1::text[])
      ORDER BY sdb.subtask_id, sdb.created_at DESC, sdb.id`,
    [subtaskIds],
  )
  const bySubtask = new Map()
  for (const r of rows) {
    if (!bySubtask.has(r.subtask_id)) bySubtask.set(r.subtask_id, [])
    bySubtask.get(r.subtask_id).push({
      id: r.id,
      designer_id: r.designer_id,
      designer_name: r.designer_name ?? null,
      pages: r.pages,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      redone_at: r.redone_at instanceof Date ? r.redone_at.toISOString() : r.redone_at,
      redone_by: r.redone_by ?? null,
      // Prefer the denormalised snapshot (stamped at write time, stays
      // accurate even if a user is later renamed); fall back to the
      // live JOIN name for rows written before the snapshot column
      // existed.
      redone_by_name: r.redone_by_name ?? r.redone_by_name_live ?? null,
    })
  }
  return bySubtask
}

/**
 * Append one designer batch row. The route layer has already
 * validated:
 *   • actor permissions (designer = own id; team_leader = any),
 *   • `pages > 0` (the column CHECK refuses non-positive inputs
 *     anyway, but the route surfaces a friendlier error),
 *   • `pages <= total_pages` (per-batch cap so a designer can't
 *     ship "the whole book and then some" in one go),
 *   • designer_id is a known active designer.
 *
 * `actorId` / `actorName` are unused here — the designer_id on the
 * row is who shipped the pages, not who clicked save. The route
 * uses actorName for the history note. Kept out of the signature
 * so the repo stays free of routing concerns.
 *
 * The trigger recomputes `subtasks.pages_done / is_done` on every
 * INSERT, so the route's slim response can read those values back
 * without writing them itself.
 */
export async function addSubtaskDesignerBatch(client, { subtaskId, designerId, pages }) {
  if (!subtaskId || !designerId || !Number.isFinite(pages) || pages <= 0) return null
  if (pages > DESIGNER_BATCH_LIMIT * 1000) {
    throw new Error(`refusing to insert a batch with pages > ${DESIGNER_BATCH_LIMIT * 1000}`)
  }
  const { rows } = await client.query(
    `INSERT INTO subtask_designer_batches (subtask_id, designer_id, pages)
     VALUES ($1::text, $2::text, $3::int)
     RETURNING id, subtask_id, designer_id, pages, created_at, redone_at, redone_by, redone_by_name`,
    [subtaskId, designerId, Math.floor(pages)],
  )
  return rows[0] ?? null
}

/**
 * Stamp the "Yeniden Çalıştım" trail on a single batch. Idempotent
 * — the UPDATE uses a guard so a row that's already been re-touched
 * doesn't churn `redone_at` (the audit trail cares about the FIRST
 * re-touch, not the most recent). The route can call this freely
 * without worrying about double-stamping.
 *
 * Returns the post-update row (with `redone_at` populated and the
 * denormalised `redone_by_name` snapshot stamped) so the SPA can
 * render the row's "✓ yeniden çalıştım, <name>" affordance without a
 * follow-up SELECT.
 */
export async function markSubtaskDesignerBatchRedone(client, { batchId, actorId, actorName }) {
  if (!batchId) return null
  // Snapshot the actor's display name at write time so the SPA
  // doesn't need to JOIN `users` at read time. The column defaults to
  // NULL when not passed; the SELECT-LEFT-JOIN fallback in
  // `loadSubtaskDesignerBatches` covers pre-snapshot rows.
  const { rows } = await client.query(
    `UPDATE subtask_designer_batches
        SET redone_at     = COALESCE(redone_at, NOW()),
            redone_by     = COALESCE(redone_by, $2::text),
            redone_by_name = COALESCE(redone_by_name, $3)
      WHERE id = $1
      RETURNING id, subtask_id, designer_id, pages, created_at, redone_at, redone_by, redone_by_name`,
    [batchId, actorId ?? null, actorName ?? null],
  )
  return rows[0] ?? null
}

/**
 * Read one subtask's batch log in stable insertion order. Convenience
 * wrapper around `loadSubtaskDesignerBatches` for routes that just
 * saved a batch and want to echo it back.
 */
export async function getSubtaskDesignerBatches(client, subtaskId) {
  const map = await loadSubtaskDesignerBatches(client, [subtaskId])
  return map.get(subtaskId) ?? []
}

/**
 * List a project's subtasks with their per-designer batch log spliced
 * on.
 *
 * Returns an array of subtask rows; rows with `kind='pages'` carry a
 * `designer_batches: [{ id, designer_id, … }, …]` array. The chip
 * grid's `pages: [{ i, status, … }]` shape is gone;
 * `designer_batches` is the per-session equivalent and drives the
 * new batch-list / input UX.
 *
 * Lives here (not in `project-repository.js`) because the return
 * shape is subtask-shaped: `loadSubtaskDesignerBatches` is a
 * subtask-level read, and the subtask list is the natural pairing
 * for it. The project-level `getProjectDetail` consumer reaches
 * this through `project-repository.js`'s barrel re-export.
 */
export async function listProjectSubtasks(client, projectId) {
  // LEFT JOIN users so each row carries `assigned_name`. Without
  // this the ProjectDetail UI can show "Kapak → u-1bMgmt0PcKOpGdvC"
  // (raw id) because it has no way to resolve the user name
  // client-side without a separate /api/users round trip per row.
  const { rows } = await client.query(
    `SELECT s.id, s.project_id, s.title, s.kind, s.is_done, s.total_pages, s.pages_done,
            s.total_stickers, s.stickers_done, s.assigned_to, s.done_at,
            s.needs_revize, s.position, s.created_at, s.updated_at,
            u.name AS assigned_name
       FROM subtasks s
       LEFT JOIN users u ON u.id = s.assigned_to
       WHERE s.project_id = $1
       -- position is the team leader's explicit order (migration 027);
       -- created_at is the tiebreaker for rows written before
       -- it existed.
       ORDER BY s.position, s.created_at`,
    [projectId],
  )
  // migration 067 — splice the per-designer batch log onto every
  // kind='pages' subtask so the new list-renders-from-the-same-
  // payload pattern the chip-grid had (no follow-up GET for the
  // batches, no follow-up GET for designer names).
  const batchesBySubtask = await loadSubtaskDesignerBatches(
    client,
    rows.filter((s) => s.kind === 'pages').map((s) => s.id),
  )
  return rows.map((s) => (
    s.kind === 'pages'
      ? { ...s, designer_batches: batchesBySubtask.get(s.id) ?? [] }
      : s
  ))
}
