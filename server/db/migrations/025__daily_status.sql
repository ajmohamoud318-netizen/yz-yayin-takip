-- 025 — daily designer/user status
--
-- A same-day, self-set free-text note ("what else I'm on today") that a
-- team leader can glance at without it needing manual cleanup: reads
-- filter on daily_status_date = CURRENT_DATE, so a stale note from a
-- previous day is simply never returned.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS daily_status TEXT,
  ADD COLUMN IF NOT EXISTS daily_status_date DATE;
