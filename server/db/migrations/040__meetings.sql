-- 040 — Toplantılar ("meetings")
--
-- A simple meeting log activated in the sidebar alongside Hedef Projeler:
-- the team leader, designers, and the printer note down a meeting's title,
-- date/time, optional notes, and an optional link to the project it
-- concerns. Mirrors target_project_ideas (036) in shape and ownership
-- rules — team_leader or the meeting's own author can edit/delete it.
--
-- project_id is ON DELETE SET NULL (not CASCADE, unlike most project-scoped
-- tables): a meeting record shouldn't vanish just because the project it
-- was linked to was later deleted — same reasoning as target_project_ideas'
-- created_by being SET NULL rather than CASCADE.

CREATE TABLE IF NOT EXISTS meetings (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  notes            TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  meeting_at       TIMESTAMPTZ NOT NULL,
  project_id       TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meetings_meeting_at ON meetings(meeting_at);
