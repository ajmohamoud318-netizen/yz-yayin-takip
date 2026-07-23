-- 016 — Persist the ozalit-request + matbaa re-delivery flags
--
-- `ozalit_requested` and the project-level `reject_target` were used by the
-- domain transitions and the UI — the ozalit_teslim two-step (leader/designer
-- requests the ozalit → matbaa delivers it) and the reject-to-matbaa
-- "re-delivery" lock — but they were never actual columns on `projects`.
-- So requesting an ozalit set a flag that was dropped on the way to the DB:
-- the matbaa never saw a pending ozalit and "Ozalit İste" appeared to do
-- nothing. Persist them like the demo_held trio (015).
--
-- Idempotent so re-running on a seeded DB is a no-op.

-- last_reject_type / last_reject_target were also phantom: computeRejection
-- sets them ('ozalit'|'demo' and the routing target) and computeAdvance reads
-- last_reject_type to send an ozalit-revision resubmit back to ozalit_teslim
-- (and to label the button "Ozalit'e Gönder"). Unpersisted, an ozalit reject
-- lost its type on reload and the resubmit wrongly went to the demo pipeline.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ozalit_requested   BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reject_target      TEXT,
  ADD COLUMN IF NOT EXISTS last_reject_type   TEXT,
  ADD COLUMN IF NOT EXISTS last_reject_target TEXT;
