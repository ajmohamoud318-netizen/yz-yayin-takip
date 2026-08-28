-- 058 — domain_events (event store)
--
-- Append-only event log that captures every business event in the same
-- transaction as the state change and notification rows. This gives us:
--   • Replay: rebuild notification state for a new consumer (Slack, email
--     digest, analytics) without changing emit() callers
--   • Audit: single source of truth for "what happened and when"
--   • SSE signal: afterCommit hook publishes to event bus, which the SSE
--     route streams to connected clients for real-time delivery
--
-- One row per business event (not per recipient). A single emit() that fans
-- out to 5 recipients creates 5 notification rows but only 1 domain_event.
-- The payload captures the full event context (event type, aggregate id,
-- actor, notification type) so a future consumer can reconstruct whatever
-- it needs without touching the notifications table.

CREATE TABLE domain_events (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  -- Machine-readable event key (e.g. 'project.transition', 'order.approved',
  -- 'demo.received'). Coarse-grained: one per business occurrence, not one
  -- per notification type.
  event_type    TEXT NOT NULL,
  -- The aggregate this event is about (project id, order id, etc). Lets a
  -- consumer query "everything that happened to project X" without parsing
  -- the payload.
  aggregate_id  TEXT,
  -- Who caused the event. Redundant with notifications.actor_id but kept
  -- here so the event log is self-contained (no need to join notifications
  -- to answer "who did this").
  actor_id      TEXT,
  -- Full event context as JSON. Includes the notification type, title, body,
  -- tone, link, and any domain-specific data (stage, action, etc). A future
  -- consumer can extract whatever it needs from this payload.
  payload       JSONB NOT NULL DEFAULT '{}',
  -- When the event occurred. Defaults to NOW() but can be overridden for
  -- backfill or testing.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Query events for a specific aggregate (project, order, etc). Used by the
-- SSE route to replay missed events on reconnect (Last-Event-ID).
CREATE INDEX idx_domain_events_aggregate ON domain_events(aggregate_id, created_at DESC);

-- Query events by type (e.g. "all project.transition events in the last hour").
-- Used by future consumers (analytics, audit) that want to filter by event kind.
CREATE INDEX idx_domain_events_type ON domain_events(event_type, created_at DESC);

-- Replay events newer than a given id. The SSE route uses this on reconnect:
-- client sends Last-Event-ID, server queries WHERE id > $1 ORDER BY created_at
-- to deliver everything the client missed while disconnected.
CREATE INDEX idx_domain_events_id ON domain_events(id);
