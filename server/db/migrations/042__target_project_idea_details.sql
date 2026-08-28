-- 042 — Hedef Proje detail view: multiple links, a photo gallery beyond
-- the cover image (037), and a notes log replacing the single `notes`
-- field.
--
-- `links` is a plain array — no per-link label, just URLs, matching the
-- original single `link` column's simplicity. Existing single links are
-- carried over as the first (only) element.
--
-- The gallery (target_project_idea_images) is deliberately separate from
-- the cover image_url/image_updated_at pair on the parent row: the cover
-- is what the card grid shows, the gallery is only visible once someone
-- opens the detail view. Each row is its own file, so unlike the cover
-- there's no need for a cache-busting timestamp — the URL is unique per
-- upload and never overwritten.
--
-- The notes log (target_project_idea_notes) replaces the single `notes`
-- textarea with a timestamped, multi-author log — closer to how the app
-- already treats work-log notes elsewhere. Existing notes are carried
-- over as the log's first entry, attributed to the idea's own author.

ALTER TABLE target_project_ideas
  ADD COLUMN IF NOT EXISTS links TEXT[] NOT NULL DEFAULT '{}';

UPDATE target_project_ideas
  SET links = ARRAY[btrim(link)]
  WHERE link IS NOT NULL AND btrim(link) <> '' AND links = '{}';

CREATE TABLE IF NOT EXISTS target_project_idea_images (
  id          TEXT PRIMARY KEY,
  idea_id     TEXT NOT NULL REFERENCES target_project_ideas(id) ON DELETE CASCADE,
  image_url   TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_target_project_idea_images_idea
  ON target_project_idea_images(idea_id, created_at);

CREATE TABLE IF NOT EXISTS target_project_idea_notes (
  id               TEXT PRIMARY KEY,
  idea_id          TEXT NOT NULL REFERENCES target_project_ideas(id) ON DELETE CASCADE,
  body             TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_target_project_idea_notes_idea
  ON target_project_idea_notes(idea_id, created_at);

INSERT INTO target_project_idea_notes (id, idea_id, body, created_by, created_by_name, created_at)
SELECT 'tpin-' || substr(md5(gen_random_uuid()::text || id), 1, 16), id, btrim(notes), created_by, created_by_name, created_at
FROM target_project_ideas
WHERE notes IS NOT NULL AND btrim(notes) <> '';

ALTER TABLE target_project_ideas DROP COLUMN IF EXISTS link;
ALTER TABLE target_project_ideas DROP COLUMN IF EXISTS notes;
