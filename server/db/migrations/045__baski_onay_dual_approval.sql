-- 045 — Baskı Onay Formu dual-approval (prepare → different-leader approve)
--
-- Migration 044 made Baskı Onayı a single-step team_leader approval. The real
-- rule is a maker-checker pair: one team leader PREPARES the form (fills it
-- in from the ozalit sheet, corrects it if needed), which pings every OTHER
-- active team leader that an approval is owed; a different team leader then
-- gives the actual "Baskı Onayı" that advances the project to Üretime Hazır.
--
-- `baski_onay_prepared_by` is a user id (not just a display name, unlike the
-- demo/ozalit "Teslim Alındı" columns) because computeApproval's baski_onay
-- branch needs to compare it against the approving actor's id, not just show
-- it — two different people can share a display name, an id can't collide.
--
-- Reset to FALSE/NULL once the project actually advances to Üretime Hazır, so
-- a later sipariş-driven pass through would need its own preparation (it
-- never revisits baski_onay today, but this keeps the columns honest either way).

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS baski_onay_prepared         BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS baski_onay_prepared_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS baski_onay_prepared_by_name TEXT,
  ADD COLUMN IF NOT EXISTS baski_onay_prepared_at      TIMESTAMPTZ;
