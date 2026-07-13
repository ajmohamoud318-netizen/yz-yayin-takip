-- 002 — projects
--
-- One row per book across all of its passes. The "pass" loop is recorded
-- in stage_history (created later) plus per-project pass counters so a
-- single SELECT can answer "what pass is this project on right now?"

CREATE TABLE projects (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('TR','CIN')),
  stage             TEXT NOT NULL DEFAULT 'tasarim'
                    CHECK (stage IN (
                      'tasarim',
                      'demo_teslim','demo_onay',
                      'ozalit_teslim','ozalit_onay',
                      'cin_demo_teslim','cin_demo_onay',
                      'uretime_hazir','uretimde','gumruk','satista'
                    )),
  assigned_to       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_month      DATE,
  demo_attempt      INTEGER NOT NULL DEFAULT 0,
  ozalit_attempt    INTEGER NOT NULL DEFAULT 0,
  pass_number       INTEGER NOT NULL DEFAULT 1,
  pass_kind         TEXT NOT NULL DEFAULT 'first_edition'
                    CHECK (pass_kind IN ('first_edition','reprint','redesign')),
  last_reject_reason TEXT,
  progress          INTEGER NOT NULL DEFAULT 0
                    CHECK (progress BETWEEN 0 AND 100),
  version           INTEGER NOT NULL DEFAULT 0,  -- optimistic concurrency on stages
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_stage      ON projects(stage);
CREATE INDEX idx_projects_assigned   ON projects(assigned_to);
CREATE INDEX idx_projects_target     ON projects(target_month);
CREATE INDEX idx_projects_created    ON projects(created_at);
