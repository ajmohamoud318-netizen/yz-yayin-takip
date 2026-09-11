-- 086 — Store each project's designer list
--
-- Until now a project's designers were never stored: every reader rebuilt
-- them from `projects.assigned_to` (the primary) plus the distinct
-- `subtasks.assigned_to` owners. That breaks as soon as a subtask has no
-- single owner. İç Sayfalar on "Tüm Tasarımcılar" is stored with
-- `assigned_to = NULL` so every project designer can log pages on it — but a
-- designer whose only work is those pages owns no subtask row, so the rebuild
-- dropped them. The project never reached them (no list entry, no assignment
-- notification), and the designer-batches gate, which asks the same rebuilt
-- list, refused their pages.
--
-- `project_assignees` is the list the team leader actually picked, in the
-- order they picked it. Readers take the union of this list, the primary and
-- the subtask owners, so a project written by a path that doesn't maintain
-- the list still resolves the way it used to.
--
-- Idempotent: the table and index are IF NOT EXISTS and the backfill is
-- ON CONFLICT DO NOTHING, so a re-run adds nothing.

CREATE TABLE IF NOT EXISTS project_assignees (
  project_id  TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  position    INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, user_id)
);

-- "Which projects is this designer on" — the reverse of the primary key.
CREATE INDEX IF NOT EXISTS idx_project_assignees_user
  ON project_assignees (user_id);

-- Backfill from what readers resolved before this migration: the primary
-- first, then subtask owners in subtask order. Designers already lost to the
-- bug can't be recovered — nothing recorded them — so the leader re-adds them
-- from the edit dialog.
INSERT INTO project_assignees (project_id, user_id, position)
SELECT project_id, user_id,
       (ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY src_rank, pos, created_at, sid) - 1)::int
  FROM (
    SELECT DISTINCT ON (project_id, user_id)
           project_id, user_id, src_rank, pos, created_at, sid
      FROM (
        SELECT p.id AS project_id, p.assigned_to AS user_id,
               0 AS src_rank, 0 AS pos, p.created_at, ''::text AS sid
          FROM projects p
         WHERE p.assigned_to IS NOT NULL
        UNION ALL
        SELECT s.project_id, s.assigned_to,
               1, COALESCE(s.position, 0), s.created_at, s.id
          FROM subtasks s
         WHERE s.assigned_to IS NOT NULL
      ) owners
     ORDER BY project_id, user_id, src_rank, pos, created_at, sid
  ) firsts
ON CONFLICT (project_id, user_id) DO NOTHING;
