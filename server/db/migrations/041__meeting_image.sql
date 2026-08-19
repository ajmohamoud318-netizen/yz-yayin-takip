-- 041 — image on a meeting (meetings, migration 040)
--
-- Same shape as target_project_ideas.image_url / image_updated_at (037):
-- `image_url` is the stable served path (`/api/meetings/<id>/image`),
-- constant across re-uploads, so `image_updated_at` is what lets the client
-- bust its cache via a `?v=` query param. The file itself lives on disk
-- (see services/meeting-images.js), not in the database.

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS image_updated_at TIMESTAMPTZ;
