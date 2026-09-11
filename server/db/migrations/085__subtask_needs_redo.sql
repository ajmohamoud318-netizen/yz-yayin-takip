-- 085 — Persist a per-subtask handover-redo flag
--
-- When the team leader reassigns a completed `check`-kind alt görev
-- (Kapak, Kutu, Kılavuz, Ses, …) to a different designer in the project
-- edit dialog, the new owner needs to know they still owe a redo pass.
-- Before this column the reopen path unchecked the subtask outright —
-- `is_done = false, done_at = NULL` — which silently stranded the
-- previous designer's completion credit and made the timeline read
-- "back to zero" rather than "handed over, please redo."
--
-- `needs_redo` is the handover-side twin of `needs_revize` (migration
-- 017). Both are side flags that leave `is_done` alone; the flagged
-- subtask stays complete (progress is NOT reduced). The new owner
-- clears the flag via `POST /subtasks/:id/redo-ack`, which is logged
-- as a `subtask_redo_acked` project-history row. Unlike revize (which
-- is triggered by a formal leader rejection through the FSM), redo is
-- triggered exclusively by the bulk-reconcile path in
-- `PUT /api/projects/:id/subtasks` when the leader swaps the row's
-- `assigned_to` on a previously-done check subtask.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE subtasks
  ADD COLUMN IF NOT EXISTS needs_redo BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index for the "which projects have redo work owed" lookup.
-- Partial so it stays small: the vast majority of subtask rows never
-- carry the flag (it is cleared on the ack click, and the only writer
-- is the leader's reassignment), so a full-column index would waste
-- space on the FALSE rows the queue query never looks at.
CREATE INDEX IF NOT EXISTS idx_subtasks_needs_redo
  ON subtasks (project_id)
  WHERE needs_redo = TRUE;
