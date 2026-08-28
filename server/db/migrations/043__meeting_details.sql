-- 043 — Toplantı detail view: multiple links, a photo gallery beyond the
-- cover image (041), and a notes log replacing the single `notes` field.
-- Mirrors 042__target_project_idea_details.sql exactly, just for meetings
-- — meetings never had a singular `link` column, so `links` starts empty.

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS links TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS meeting_images (
  id          TEXT PRIMARY KEY,
  meeting_id  TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  image_url   TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_images_meeting
  ON meeting_images(meeting_id, created_at);

CREATE TABLE IF NOT EXISTS meeting_notes (
  id               TEXT PRIMARY KEY,
  meeting_id       TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  body             TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_notes_meeting
  ON meeting_notes(meeting_id, created_at);

INSERT INTO meeting_notes (id, meeting_id, body, created_by, created_by_name, created_at)
SELECT 'mtgn-' || substr(md5(gen_random_uuid()::text || id), 1, 16), id, btrim(notes), created_by, created_by_name, created_at
FROM meetings
WHERE notes IS NOT NULL AND btrim(notes) <> '';

ALTER TABLE meetings DROP COLUMN IF EXISTS notes;
