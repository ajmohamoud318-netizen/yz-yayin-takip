-- 018 — Persist the rejection type + target on the project
--
-- computeRejection sets last_reject_type ('ozalit' | 'demo') and
-- last_reject_target, and computeAdvance reads last_reject_type to route an
-- ozalit-revision resubmit back to ozalit_teslim (and to label the button
-- "Ozalit'e Gönder"). Unpersisted, an ozalit reject lost its type on reload
-- and the resubmit wrongly dropped into the demo pipeline.
--
-- These were briefly added to migration 016, but 016 had already been applied
-- in production and the runner skips already-applied IDs — so that edit never
-- ran (it caused a 500 on any column-referencing query). New columns must go
-- in a fresh migration. Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS last_reject_type   TEXT,
  ADD COLUMN IF NOT EXISTS last_reject_target TEXT;
