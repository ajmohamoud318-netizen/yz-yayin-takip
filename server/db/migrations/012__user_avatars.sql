-- 012 — User avatars
--
-- Adds per-user profile photo storage. The actual binary lives on disk
-- under `server/uploads/avatars/<userId>.<ext>` (served by
-- `GET /api/users/me/avatar/file`). We persist only the URL on the user
-- row so the SPA can render <img src=…> without an extra round trip.
--
-- Both columns are nullable; existing seeded users keep no avatar until
-- they upload one.
--
-- Idempotent — safe to re-run.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url       TEXT,
  ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMPTZ;
