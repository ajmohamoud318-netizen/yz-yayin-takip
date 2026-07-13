-- 006 — handovers (teslim / matbaa → satis)
--
-- When the printer finishes the final production stage they raise a
-- handover for the project. Sales confirms "Alındı", and that's the
-- event that moves the project to satista.

CREATE TABLE handovers (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','received')),
  from_stage        TEXT NOT NULL,
  raised_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  confirmed_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_handovers_pending_per_project
  ON handovers(project_id) WHERE status = 'pending';

CREATE INDEX idx_handovers_status ON handovers(status);
