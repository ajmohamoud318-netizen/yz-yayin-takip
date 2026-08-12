-- 032 — web push subscriptions
--
-- Migration 022 made notifications durable server-side, but delivery was
-- still pull-only: the SPA polls GET /api/notifications every 15s, which
-- means a user only learns about a demo/ozalit request while the tab is
-- open. For the matbaa team (who are on the print floor, not at a desk)
-- that is the same as no notification at all.
--
-- This table stores W3C Push API subscriptions so the server can PUSH to a
-- device even when the SPA is closed. Each row is one browser-on-one-device:
-- the same user signing in from a phone and a laptop yields two rows, and
-- both get notified. Delivery fans out from services/notifications.js#emit,
-- so every existing notify* helper gains push without changing a call site.
--
-- WhatsApp was the original ask here; it was rejected because Meta's Cloud
-- API bills per business-initiated message (and stops exempting in-window
-- utility messages on 2026-10-01). Web push is free, needs no third party,
-- and works on both iOS 16.4+ (installed to Home Screen) and Android.
--
-- TEXT ids to match the rest of the schema, defaulted like notifications /
-- stage_history so inserts don't have to mint one.

CREATE TABLE push_subscriptions (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  -- Owner. ON DELETE CASCADE: deactivating/removing a user takes their
  -- devices with them, so a deleted account can never keep receiving pushes.
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The push service URL (fcm.googleapis.com, web.push.apple.com, …). This
  -- is the true identity of a subscription: unique across the whole table,
  -- because the SAME device re-subscribing must update the existing row
  -- rather than accumulate duplicates (which would double-notify). The
  -- subscribe route relies on this constraint for its ON CONFLICT upsert.
  endpoint      TEXT NOT NULL UNIQUE,
  -- Encryption material from PushSubscription.getKey(). Opaque base64url;
  -- consumed by the `web-push` library to seal the payload so the push
  -- service itself cannot read the notification body.
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  -- Diagnostics only — lets an admin tell "Oktay's iPhone" from "Oktay's
  -- laptop" when a subscription misbehaves. Never used for logic.
  user_agent    TEXT NOT NULL DEFAULT '',
  -- Bumped on every successful send. A subscription that has not been used
  -- in months is a candidate for pruning; also useful for debugging "did
  -- this device actually get it?".
  last_used_at  TIMESTAMPTZ,
  -- Set when the push service rejects delivery with 404/410 (subscription
  -- permanently gone — user revoked permission, cleared site data, or
  -- uninstalled the PWA). We soft-mark before deleting so a transient
  -- misread can be inspected; services/push.js deletes on the next sweep.
  failed_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fan-out query: "every device belonging to these N recipients". This is the
-- only read path that matters (one lookup per emit), so index it directly.
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
