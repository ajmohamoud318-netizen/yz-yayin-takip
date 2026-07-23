-- 017 — Persist the per-subtask revision flag
--
-- When the team leader rejects to the designer and flags subtasks to revise,
-- `needs_revize` marks them. It drives the whole revision UI, but it was never
-- a column — so the flag vanished on save and no revision state survived a
-- reload. The flagged subtask stays complete (progress is NOT reduced); the
-- designer clears the flag via the "Revize" action once reworked, which is
-- logged in the project history.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE subtasks
  ADD COLUMN IF NOT EXISTS needs_revize BOOLEAN NOT NULL DEFAULT FALSE;
