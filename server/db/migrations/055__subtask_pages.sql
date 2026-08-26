-- 055 — subtask_pages: per-page state for the "İç Sayfalar" subtask.
--
-- The team leader sets `total_pages` when creating the project; the designer's
-- work is then to mark each individual page done (or rework a previously
-- done page). Before this table the project only had `pages_done` as a single
-- INTEGER, which collapsed the work to "5 of 48 done" — designers could not
-- tell which page was the 5th, multiple designers on the same project could
-- not split pages between them, and a reworked page was indistinguishable
-- from a page that was never finished.
--
-- One row per page, created at subtask creation time (POST /projects and
-- PUT /projects/:id/subtasks both seed the rows when kind='pages' and
-- total_pages changes). The whole list is loaded with the subtask via
-- `listProjectSubtasks`, which now LEFT JOINs and aggregates the rows into a
-- `pages` JSON array on each subtask. The client's chip grid renders that
-- array directly — no per-page GET roundtrip.
--
-- `rework_count` is incremented whenever a page flips back to 'rework', so
-- the team leader can spot pages that bounced more than once without having
-- to scrape stage_history. We do NOT model a full rework history here — the
-- stage_history row written by PATCH /subtasks/:id/pages/:pageIndex already
-- records who reworked what when, and that's the canonical audit trail.
--
-- Idempotent: re-running on a seeded DB leaves an empty no-op behind.

CREATE TABLE IF NOT EXISTS subtask_pages (
  id            SERIAL PRIMARY KEY,
  subtask_id    TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  page_index    INTEGER NOT NULL CHECK (page_index >= 1),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','done','rework')),
  done_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  done_at       TIMESTAMPTZ,
  rework_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subtask_id, page_index)
);

CREATE INDEX IF NOT EXISTS idx_subtask_pages_subtask
  ON subtask_pages (subtask_id, page_index);
