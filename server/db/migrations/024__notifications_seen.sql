-- 024 — notifications: seen vs read split
--
-- Two independent states, matching how real work-queue notifications behave:
--
--   • seen     drives the red bell BADGE. Set when the user OPENS the bell
--              (a glance counts). Clears the count so the bell doesn't nag.
--   • is_read  drives the per-item BOLD / to-do styling. Only set when the
--              user actually clicks the item (or the underlying work is done).
--
-- Invariant: is_read ⇒ seen (reading something means you've seen it). The
-- service enforces this by setting seen=TRUE wherever it sets is_read=TRUE.
--
-- Before this migration the badge was driven by is_read, so peeking at the
-- bell left everything "unread" and the count stuck — or, if we'd cleared it
-- on open, we'd have lost the per-item to-do signal. Splitting the two gives
-- the clean app-like badge AND keeps unread as a genuine to-do marker.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS seen    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ;

-- Badge count query: unseen rows per recipient. Partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_notifications_unseen
  ON notifications(user_id) WHERE seen = FALSE;
