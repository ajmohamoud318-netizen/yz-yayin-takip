-- 034 — notification delivery state (push outbox) + retention
--
-- Migration 032 gave us push, dispatched from services/notifications.js#emit
-- via `client.afterCommit`. That fixed the two hard problems (never push for a
-- rolled-back transaction; never hold a pool connection across an HTTPS
-- round-trip) but left one: the send itself was fire-and-forget in memory.
--
-- If the process is SIGTERM'd, OOM-killed, or redeployed in the window between
-- COMMIT and the webpush call — a window that is small but is hit every single
-- deploy, because Dokploy stops the old container mid-request — the push is
-- gone with no record that it was ever owed. The bell still shows it (the row
-- committed), so the bug is invisible in testing and only manifests as "Oktay
-- says he never got a notification for that ozalit".
--
-- The fix is the outbox pattern, and we already have the outbox: `notifications`
-- IS the durable log of what should be delivered. All it was missing is
-- delivery state. With `pushed_at` NULL meaning "owed", a sweeper can pick up
-- anything the in-process dispatch dropped (see services/notification-
-- maintenance.js). At-least-once delivery, which is the correct trade here —
-- a duplicate push collapses under the payload's `tag`, a lost one doesn't.
--
-- `push_attempts` bounds the retry: a notification whose recipients' devices
-- are all failing transiently must not be retried forever. After
-- PUSH_MAX_ATTEMPTS the row is marked pushed anyway (delivery abandoned, bell
-- feed unaffected) so the pending index stays small.
--
-- IMPORTANT: when web push is disabled server-side (no VAPID keys — the local
-- dev default) `emit` stamps `pushed_at = NOW()` at insert time. Otherwise
-- every row in every dev database would sit in the "owed" set forever and the
-- partial index below would degenerate into a full-table index.

ALTER TABLE notifications
  -- When the push for this row was delivered, or definitively given up on.
  -- NULL = still owed. Set at INSERT time when push is disabled.
  ADD COLUMN IF NOT EXISTS pushed_at     TIMESTAMPTZ,
  -- Transient-failure counter. Only incremented when a send was attempted and
  -- every device returned a retryable error (network, 429, 5xx). A 404/410 is
  -- NOT transient — the device is dead, and a row with no live device left is
  -- settled, not retried.
  ADD COLUMN IF NOT EXISTS push_attempts SMALLINT NOT NULL DEFAULT 0;

-- The sweeper's only query: "what is still owed, oldest first". Partial on
-- pushed_at IS NULL so the index holds just the in-flight tail (normally a
-- handful of rows for a few seconds) rather than the whole table.
CREATE INDEX IF NOT EXISTS idx_notifications_push_pending
  ON notifications(created_at) WHERE pushed_at IS NULL;

-- Backfill: everything that predates this migration was either delivered or
-- lost long ago. Leaving them NULL would make the sweeper's first run push the
-- entire history to every device at once — which is exactly the kind of
-- spectacular deploy that gets a notification feature turned off for good.
UPDATE notifications SET pushed_at = created_at WHERE pushed_at IS NULL;

-- Retention. Until now nothing ever deleted a notification row, so the table
-- grew monotonically with pipeline activity (every transition fans out to
-- 2–6 recipients) while the feed only ever shows the newest page. The pruner
-- in services/notification-maintenance.js deletes on this index.
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
