-- 037 — image on a Hedef Proje idea (target_project_ideas, migration 036)
--
-- Same shape as users.avatar_url / avatar_updated_at: `image_url` is the
-- stable served path (`/api/target-project-ideas/<id>/image`), constant
-- across re-uploads, so `image_updated_at` is what lets the client bust its
-- cache via a `?v=` query param. The file itself lives on disk (see
-- services/idea-images.js), not in the database.

ALTER TABLE target_project_ideas
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS image_updated_at TIMESTAMPTZ;
