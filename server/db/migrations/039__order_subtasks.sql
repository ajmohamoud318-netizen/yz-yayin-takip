-- 039 — order_subtasks: per-order snapshot of the project's alt görevler
--
-- Two concurrent order_requests on the same project_id used to share the
-- project's single `subtasks` table for the goruldu-step checklist AND the
-- leader's reject-to-designer revize picker. Two live orders on one project
-- could then flip needs_revize / is_done / pages_done on the SAME rows,
-- corrupting each other's rework tracking. order_subtasks gives each order
-- its own copy, cloned from `subtasks` at POST /order-requests time, so
-- concurrent orders can never see or touch each other's state again.
--
-- `source_subtask_id` is kept only for display/provenance (so a UI could
-- someday show "this snapshot came from Kapak"); it is NOT used to route
-- writes anywhere. ON DELETE SET NULL — deleting or reshaping the live
-- subtask later (team leader edits the list) must never cascade into an
-- already-signed-or-in-flight order snapshot.

CREATE TABLE order_subtasks (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id           TEXT NOT NULL REFERENCES order_requests(id) ON DELETE CASCADE,
  source_subtask_id  TEXT REFERENCES subtasks(id) ON DELETE SET NULL,
  title              TEXT NOT NULL,
  kind               TEXT NOT NULL DEFAULT 'check'
                     CHECK (kind IN ('check','pages','sticker-count')),
  is_done            BOOLEAN NOT NULL DEFAULT FALSE,
  total_pages        INTEGER,
  pages_done         INTEGER NOT NULL DEFAULT 0,
  total_stickers     INTEGER,
  stickers_done      INTEGER NOT NULL DEFAULT 0,
  done_at            TIMESTAMPTZ,
  needs_revize       BOOLEAN NOT NULL DEFAULT FALSE,
  position           INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_subtasks_order ON order_subtasks(order_id);
