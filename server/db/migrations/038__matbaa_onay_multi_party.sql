-- 038 — matbaa_onay multi-party approval + "Teslim Alındı" receipt gate
--
-- The sipariş (sales reprint order) mini-workflow's matbaa_onay step is the
-- sales-side twin of the main pipeline's ozalit_onay: matbaa delivers a
-- physical proof of the reprint and the team leader signs off before the
-- order is released into production. Until now that sign-off was a single
-- team_leader click straight to onaylandi — no receipt gate, no requirement
-- that assigned designers also approve. This brings matbaa_onay to full
-- parity with ozalit_onay (see migrations 019 and 035):
--
--   • matbaa_received / matbaa_received_by / matbaa_received_at — the
--     "Teslim Alındı" gate. Nobody may approve until a team leader or an
--     assigned designer acknowledges the delivered proof.
--   • matbaa_approvals — the multi-party ledger. Every active team leader
--     AND every assigned designer (order.assignee_ids) must approve before
--     the order advances to onaylandi; a team leader has to go first.
--
-- Not backfilled, same reasoning as 035: orders already sitting at
-- matbaa_onay start unreceived and their approvers acknowledge the proof
-- once, like every round after this one.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE order_requests
  ADD COLUMN IF NOT EXISTS matbaa_received     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS matbaa_received_by  TEXT,
  ADD COLUMN IF NOT EXISTS matbaa_received_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS matbaa_approvals    JSONB       NOT NULL DEFAULT '[]'::jsonb;
