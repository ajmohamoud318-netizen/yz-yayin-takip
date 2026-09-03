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

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ozalit_requested   BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reject_target      TEXT;
