-- 026 — work log ("Çalışma Defteri")
--
-- Supersedes the single free-text `users.daily_status` note added in 025.
--
-- Why replace it: 025 could hold exactly ONE sentence per person per day, so
-- a designer who spent the morning in a toplantı and the afternoon on another
-- book had to overwrite the first note to record the second. The leader saw
-- half the story, and there was no way to look back at last Thursday. This
-- table stores many entries per person per day, each typed (`kind`) and
-- optionally timed (`minutes`), and keeps history.
--
-- Design notes:
--   • `entry_date` is a DATE, not derived from created_at, so an entry logged
--     at 00:20 for the previous working day can be corrected without fighting
--     timezones. Reads for "today" filter on entry_date = CURRENT_DATE, which
--     is the same self-cleaning property 025 had — nothing to purge.
--   • `kind` is a plain TEXT + CHECK rather than an ENUM: adding a category is
--     then a one-line migration instead of ALTER TYPE gymnastics.
--   • ON DELETE CASCADE from users — a deleted account takes its log with it
--     (matches how invitations/password_resets behave).

CREATE TABLE IF NOT EXISTS work_log_entries (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  kind        TEXT NOT NULL DEFAULT 'diger'
              CHECK (kind IN ('baska_proje', 'toplanti', 'idari', 'egitim', 'diger')),
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 280),
  -- Optional rough duration in minutes. NULL = "didn't bother to say".
  minutes     INTEGER CHECK (minutes IS NULL OR (minutes > 0 AND minutes <= 24 * 60)),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The two shapes of read we actually do:
--   1. "my log, newest first, walking back through days"  → (user_id, entry_date)
--   2. "everyone's entries for one day" (leader, /team)   → (entry_date)
CREATE INDEX IF NOT EXISTS idx_work_log_user_date
  ON work_log_entries(user_id, entry_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_log_date
  ON work_log_entries(entry_date DESC, created_at DESC);

-- Carry over any note that was live under 025 so nobody loses today's status
-- mid-deploy. Untyped, so it lands in 'diger'.
INSERT INTO work_log_entries (id, user_id, entry_date, kind, body, created_at, updated_at)
SELECT
  'wl-mig-' || u.id,
  u.id,
  u.daily_status_date,
  'diger',
  left(btrim(u.daily_status), 280),
  NOW(),
  NOW()
FROM users u
WHERE u.daily_status IS NOT NULL
  AND btrim(u.daily_status) <> ''
  AND u.daily_status_date IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- 025's columns are now dead weight: `daily_status` is derived from this table
-- (see the LATERAL sub-selects in routes/auth.js, routes/users.js,
-- services/sessions.js and middleware/auth.js), so keeping them would leave two
-- sources of truth for the same sentence.
ALTER TABLE users
  DROP COLUMN IF EXISTS daily_status,
  DROP COLUMN IF EXISTS daily_status_date;
