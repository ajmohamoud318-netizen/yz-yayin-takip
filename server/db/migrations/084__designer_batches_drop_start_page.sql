-- 084 — drop start_page: designer batches go back to a shared additive counter.
--
-- 068 (backfilled by 072) pinned each batch to a closed page range
-- [start_page, start_page + pages - 1] so two designers couldn't claim the
-- same page twice. In practice the slot model confused everybody who used
-- it: designers weren't shipping "pages 5-14", they were saying "I did 10
-- pages today" and asking the app to keep count. The route's overlap probe
-- refused perfectly reasonable saves ("pages 1-10 already claimed by Ayşe;
-- I really did just do 10 more"), and the team leader kept getting pulled
-- in to retract and re-log to shuffle the ranges around.
--
-- The new model is the pre-068 model with the audit trail 067/071 gave us:
-- every save is a "+N sayfa today" additive row on ONE shared subtask
-- counter. No slot. No overlap. Two designers each shipping "+5" leaves
-- the subtask at 10, which is exactly what they both mean.
--
-- What still writes pages_done / stickers_done: the trigger installed in
-- 071 and re-shaped in 082 (`recompute_subtask_pages_counter`). It sums
-- `pages` across every batch on the subtask and slams the total onto
-- subtasks.pages_done or subtasks.stickers_done depending on kind. That
-- logic is untouched here — the trigger never read start_page. Dropping
-- the column just removes a value nobody consumes.
--
-- Schema change:
--   • DROP INDEX idx_subtask_designer_batches_subtask_start — served only
--     the overlap probe, which is gone.
--   • ALTER TABLE subtask_designer_batches DROP COLUMN start_page — takes
--     its CHECK constraint down with it.
--
-- Idempotent:
--   • DROP INDEX IF EXISTS — a re-run against a DB where 084 has already
--     torn the index down is a clean no-op.
--   • DROP COLUMN IF EXISTS — same story: re-running finds nothing to
--     drop and returns without error.

DROP INDEX IF EXISTS idx_subtask_designer_batches_subtask_start;

ALTER TABLE subtask_designer_batches
  DROP COLUMN IF EXISTS start_page;
