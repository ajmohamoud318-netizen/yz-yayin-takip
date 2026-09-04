-- 070 — Baskı onayı per-parça dual-leader ledger
--
-- baski_onay (TR) and cin_baski_onay (ÇİN) use a maker-checker rule
-- (migration 045): one team leader prepares the print-spec form, a DIFFERENT
-- team leader approves it. Today the project-level baski_onay_prepared_* /
-- baski_onay_approver_* columns track the whole project as a single
-- maker-checker pair, so a single parça with a wrong adet forces the
-- leader to re-prepare every parça on the sheet — losing the per-parça
-- signal the recipe encodes.
--
-- This ledger keeps the dual-leader rule but splits it per parça:
--
--   baski_parca_preparers: { '<parca>': { by, by_name, at } }
--   baski_parca_approvals: { '<parca>': { by, by_name, at } }
--     Each parça carries its own preparer + approver pair. The approver
--     must be a different leader than the preparer — same maker-checker
--     rule as migration 045, just scoped to one parça. Project advances
--     to uretime_hazir / uretimde when every parça in the latest
--     baski_onay snapshot's _selectedComponents has both.
--
--   cin_baski_parca_preparers / cin_baski_parca_approvals mirror for ÇİN.
--
-- The project-level baski_onay_prepared_* columns are kept as-is: the
-- single-leader "Hazırla" button and the existing approval view still
-- read them. They stay in sync with the per-parça ledger when the last
-- parça completes (write-through in computeApproval / computeBaskiOnayPrepare).
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS baski_parca_preparers     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS baski_parca_approvals     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS cin_baski_parca_preparers JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS cin_baski_parca_approvals JSONB NOT NULL DEFAULT '{}'::jsonb;