-- 028 — explicit subtask ordering
--
-- Until now the order of a project's subtasks was an accident of
-- `ORDER BY s.created_at`, which only produced the team leader's intended
-- order because `PUT /projects/:id/subtasks` deleted every row and
-- re-inserted the whole list in payload order on each save.
--
-- That re-insert is being removed (it silently destroyed designer data —
-- see the reconcile in routes/subtasks.js), so ordering needs to stop
-- riding on row creation time and become a column we actually control.
--
-- Backfill assigns positions per project in the existing created_at order,
-- so no project's subtask list visibly changes when this is applied.

ALTER TABLE subtasks
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

UPDATE subtasks s
   SET position = ordered.rn
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) - 1 AS rn
      FROM subtasks
  ) AS ordered
 WHERE s.id = ordered.id;

-- Reads are always "this project's subtasks, in order".
CREATE INDEX IF NOT EXISTS idx_subtasks_project_position
  ON subtasks(project_id, position);
