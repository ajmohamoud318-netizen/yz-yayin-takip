-- 003 — subtasks + per-subtask updates
--
-- The frontend models both checklist subtasks ("Kapak", "Kutu" etc.) and
-- numeric ones ("Sayfa Sayısı", "Sticker"). We keep one table for them
-- and discriminate via `kind`. `pages_done` / `stickers_done` are NULL
-- unless kind = 'pages' / 'sticker-count'.

CREATE TABLE subtasks (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'check'
                  CHECK (kind IN ('check','pages','sticker-count')),
  is_done         BOOLEAN NOT NULL DEFAULT FALSE,
  total_pages     INTEGER,
  pages_done      INTEGER NOT NULL DEFAULT 0,
  total_stickers  INTEGER,
  stickers_done   INTEGER NOT NULL DEFAULT 0,
  assigned_to     TEXT REFERENCES users(id) ON DELETE SET NULL,
  done_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subtasks_project ON subtasks(project_id);

-- Designer-side notes attached to a subtask (rendered as a timeline strip
-- inside ProjectDetail.jsx). One subtask → many notes.
CREATE TABLE subtask_updates (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  subtask_id    TEXT NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  note          TEXT NOT NULL,
  author_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subtask_updates_subtask ON subtask_updates(subtask_id);
