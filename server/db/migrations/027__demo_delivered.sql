-- 027 — Demo delivery attribution (matbaa → demo_onay)
--
-- computeDemoTeslimAdvance (the matbaa's "Demo Teslim Et" advance) has
-- always stamped demo_delivered_at/demo_delivered_by/demo_delivered_by_name
-- on the in-memory project object, and the "resend a second demo" and
-- "Teslim Alınamadı" transitions null them back out — but the columns were
-- never created, so none of that ever reached the database. Adding them so
-- the timeline/UI can eventually show who delivered a demo and when,
-- matching the demo_held (015) / demo_received (021) pattern.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS demo_delivered_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS demo_delivered_by       TEXT,
  ADD COLUMN IF NOT EXISTS demo_delivered_by_name  TEXT;
