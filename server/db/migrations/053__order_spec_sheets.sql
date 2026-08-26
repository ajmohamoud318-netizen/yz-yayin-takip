-- 053 — Give the sipariş's ozalit round a real spec sheet of its own.
--
-- Until now the two pipelines' ozalit rounds only LOOKED alike. The main
-- pipeline snapshots every round into `demos` (kind='ozalit', attempt =
-- projects.ozalit_attempt), so each round is an immutable sheet the timeline
-- can reopen. The sipariş side had nothing: its "Ozalit Formu" button
-- fetched the PROJECT and opened the project's sheet read-only, and the only
-- thing a sipariş ozalit actually wrote was the shared, project-scoped
-- product_info row. Two concurrent orders on one title therefore shared one
-- sheet, no sipariş round was ever reopenable, and none of the İSTEM /
-- TESLİM / ONAY stamps the printed sheet carries were recorded per order.
--
-- The reçete (parça specs) stays shared and project-scoped on purpose — a
-- sipariş is a reprint of the same product, and Baskı Reçeteleri is the one
-- source both pipelines read. What becomes order-scoped is the SHEET: which
-- reçete rows this round went out with, its stamps, and its round number.
--
--   • demos.order_id — NULL for a project's own round (every existing row),
--     set for a sipariş's. project_id stays NOT NULL either way, so a
--     sipariş sheet still points at the product it belongs to; every lookup
--     now keys on (project_id, order_id, kind, attempt). Callers reading the
--     project's own sheets MUST filter order_id IS NULL, or a sipariş round
--     would surface as the project's latest ozalit.
--
--   • order_requests.ozalit_attempt — the sipariş's own round counter,
--     twin of projects.ozalit_attempt. Bumped by the two events that
--     invalidate a delivered proof: "Teslim Alınamadı"
--     (matbaa-not-received) and a reject back to the matbaa. Orders used to
--     borrow the project's counter for this, which numbered a sipariş round
--     after unrelated project rounds and vice versa.
--
--   • order_history.demo_id — which snapshot a sipariş history row produced,
--     exactly as migration 052 did for stage_history and for the same
--     reason: two corrections of one round land in the same attempt slot, so
--     an attempt lookup alone always resolves to the later of them.
--     ON DELETE SET NULL — losing a snapshot must never delete the timeline
--     row saying the edit happened.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE demos
  ADD COLUMN IF NOT EXISTS order_id TEXT REFERENCES order_requests(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_demos_order ON demos (order_id);

ALTER TABLE order_requests
  ADD COLUMN IF NOT EXISTS ozalit_attempt INTEGER NOT NULL DEFAULT 0;

ALTER TABLE order_history
  ADD COLUMN IF NOT EXISTS demo_id TEXT REFERENCES demos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_history_demo ON order_history (demo_id);
