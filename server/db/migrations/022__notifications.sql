-- 022 — notifications
--
-- Durable, per-recipient notification feed. Until this pass, "notifications"
-- were derived entirely client-side: NotificationSync diffed the project
-- list into ephemeral toasts, and the bell projected current project/order
-- state into a localStorage log. Both were best-effort, per-browser, and
-- lost on refresh / device switch.
--
-- This table makes every notification a real event: written server-side in
-- the SAME transaction as the stage-history row that caused it (see
-- services/notifications.js#emit, called from the transition routes), so a
-- notification exists iff the state change committed. The SPA polls
-- GET /api/notifications and renders straight from these rows — no more
-- guessing from state.
--
-- TEXT ids to match the rest of the schema (users/projects use TEXT, seeded
-- as 'u-ayse', 'p-<nanoid>' etc). id defaults to gen_random_uuid()::text
-- exactly like stage_history so inserts don't have to mint an id.

CREATE TABLE notifications (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  -- Recipient. One row per user, so a "notify all team leaders" event fans
  -- out to N rows (one each). ON DELETE CASCADE: removing a user clears
  -- their feed.
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Machine-readable event key (e.g. 'demo_approval_pending', 'assignment',
  -- 'rejection', 'order_step', 'handover_confirmed'). Drives the toast/icon
  -- on the client and lets us group or filter later.
  type          TEXT NOT NULL,
  -- Human-facing title (usually the project or order title) + body message.
  title         TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL DEFAULT '',
  -- UI accent used by the bell dot / toast variant.
  tone          TEXT NOT NULL DEFAULT 'blue'
    CHECK (tone IN ('amber','green','rose','blue','pink')),
  -- Optional links back to the source aggregate. project_id cascades; order
  -- ids are TEXT but we don't hard-FK them (orders can be pruned independently
  -- and a stale link just falls back to a route).
  project_id    TEXT REFERENCES projects(id) ON DELETE CASCADE,
  order_id      TEXT,
  -- SPA route to open when the notification is clicked (e.g. '/approvals/demo'
  -- or a project detail). Null → open the project detail sheet by project_id.
  link          TEXT,
  -- Who caused the event. Used to suppress self-notifications (you don't get
  -- pinged for your own action).
  actor_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Feed query: newest-first per recipient.
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
-- Unread badge count: partial index keeps it tiny.
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE is_read = FALSE;
