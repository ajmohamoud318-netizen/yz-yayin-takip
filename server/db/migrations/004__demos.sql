-- 004 — demos
--
-- A demo is a per-project submission form that the printer uses to
-- deliver the demo / ozalit. The payload is flexible enough to evolve
-- the form without further migrations — kept as JSONB.

CREATE TABLE demos (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'demo'
                CHECK (kind IN ('demo','ozalit')),
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt       INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_demos_project ON demos(project_id);
