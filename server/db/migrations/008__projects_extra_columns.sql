-- 008 — projects extras
--
-- The original 002__projects.sql already declares these columns, but a few
-- dev DBs were initialised by hand (before the runner existed) and ended
-- up missing them. The repository in server/src/services/project-repository.js
-- SELECTs all of them, so any drift shows up as a 500 on /api/projects.
--
-- This migration is fully idempotent (IF NOT EXISTS + safe defaults), so
-- fresh clones can run it without breaking existing data.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ozalit_attempt    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pass_number       INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pass_kind         TEXT
    CHECK (pass_kind IS NULL OR pass_kind IN ('first_edition','reprint','redesign')),
  ADD COLUMN IF NOT EXISTS last_reject_reason TEXT,
  ADD COLUMN IF NOT EXISTS version           INTEGER NOT NULL DEFAULT 0;