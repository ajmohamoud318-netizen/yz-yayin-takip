-- 007 — stage_history + invitations
--
-- stage_history is append-only project timeline. Every advance, approval
-- and rejection is logged with reason and reject_target so the project
-- modal can render the complete story.

CREATE TABLE stage_history (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_stage      TEXT,
  to_stage        TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('create','advance','approve','reject','system')),
  reason          TEXT,
  reject_target   TEXT,                  -- 'matbaa' | 'designer' | 'reassign'
  pass_number     INTEGER NOT NULL DEFAULT 1,
  done_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_history_project ON stage_history(project_id);
CREATE INDEX idx_history_action  ON stage_history(action);

-- Single-use invitation tokens. expires_at is a hard deadline; used_at
-- closes the token. Password column on users stays null until accepted.
CREATE TABLE invitations (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         TEXT UNIQUE NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invitations_user  ON invitations(user_id);
CREATE INDEX idx_invitations_token ON invitations(token);
