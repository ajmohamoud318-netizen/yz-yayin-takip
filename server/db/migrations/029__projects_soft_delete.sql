-- 029 — soft-delete for projects
--
-- Deleting a project used to be a hard `DELETE FROM projects`. This adds a
-- `deleted_at` marker (plus who deleted it) so the team leader can find and
-- restore a project from the new "Silinen Projeler" page instead of losing
-- it permanently on a misclick.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_by_name TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects (deleted_at);
