-- 046 — Ekran Onayı + Sipariş Baskı Onay Formu
--
-- Extends the sipariş status machine with two new steps, inserted between
-- the existing tasarimci_onay/matbaa_onay round and onaylandi:
--
--   • ekran_onay          — single team_leader digital approval, offered as
--     an alternative to tasarimci_onay ONLY on a resubmit after a
--     reject-to-designer (the very first submission from goruldu still goes
--     straight to tasarimci_onay). No receipt gate, no multi-party ledger
--     (unlike matbaa_onay) — one click.
--   • siparis_baski_onay  — the sales-side twin of the main pipeline's
--     baski_onay: one team leader edits a print-spec form and approves in a
--     single action (no maker-checker, no reject flow — mirrors the
--     project-side baski_onay's documented "edit instead of reject" rule).
--     Both matbaa_onay (once fully approved) and ekran_onay funnel into
--     this step; only ITS completion advances the order to onaylandi and
--     flips the linked project into uretimde.
--
-- Named siparis_baski_onay (not baski_onay) on purpose — projects.stage
-- already has an unrelated baski_onay value (migration 044); reusing the
-- same string on order_requests would be a grep/mental-model hazard even
-- though the two are different tables/columns.
--
-- New columns:
--   • last_reject_type — resubmit-after-reject flag, mirrors
--     projects.last_reject_type. Set to 'designer' whenever a reject sends
--     the order back to goruldu (from either matbaa_onay or ekran_onay).
--     Cleared the moment the order next leaves goruldu — that's the one
--     click that reads it to decide whether to offer the
--     tasarimci_onay/ekran_onay choice at all.
--   • baski_onay_form — the siparis_baski_onay print-spec snapshot (per-parça
--     rows + adet/tarih/basımYeri/hazırlayan + approval stamp). A JSONB
--     column on order_requests, NOT a new demos row: demos.project_id is
--     NOT NULL with no order_id column, so two concurrent orders on the
--     same project would collide on the same demos row. This follows the
--     existing convention of order-owned JSONB state (matbaa_approvals).
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE order_requests DROP CONSTRAINT order_requests_status_check;
ALTER TABLE order_requests ADD CONSTRAINT order_requests_status_check CHECK (status IN (
  'pending','goruldu','tasarimci_onay','ekran_onay','matbaa_onay',
  'siparis_baski_onay','onaylandi','rejected'
));

ALTER TABLE order_requests
  ADD COLUMN IF NOT EXISTS last_reject_type TEXT CHECK (last_reject_type IN ('designer')),
  ADD COLUMN IF NOT EXISTS baski_onay_form  JSONB NOT NULL DEFAULT '{}'::jsonb;
