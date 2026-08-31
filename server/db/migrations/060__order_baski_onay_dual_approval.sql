-- 060 — Sipariş Baskı Onayı dual-approval (prepare → different-leader approve)
--
-- Migration 046 gave orders their own print-approval gate, `siparis_baski_onay`,
-- as "the sales-side twin of the main pipeline's baski_onay". It was not
-- actually a twin: the project side got the maker-checker pair in migration
-- 045 (one leader prepares, a DIFFERENT leader approves), while the order side
-- stayed a single team_leader signature that both filled the form and signed
-- it.
--
-- That gap was invisible while only one team leader account was active — with
-- a single active leader migration 045's rule collapses to self-approval
-- anyway, so both pipelines behaved identically. It becomes real the moment a
-- second leader is activated: projects would need two people, sipariş would
-- still let one leader push a print run to `baskida` alone. Since a sipariş
-- commits the same money to the same matbaa as a project pass does, the two
-- gates should agree.
--
-- Columns mirror `projects` (migration 045) exactly, including the id-not-name
-- rule: `baski_onay_prepared_by` is compared against the approving actor's id,
-- and two leaders can share a display name where an id cannot collide.
--
-- Reset to FALSE/NULL once the order advances to `onaylandi`, so a re-opened
-- or re-run gate would need its own preparation rather than inheriting a stale
-- one.

ALTER TABLE order_requests
  ADD COLUMN IF NOT EXISTS baski_onay_prepared         BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS baski_onay_prepared_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS baski_onay_prepared_by_name TEXT,
  ADD COLUMN IF NOT EXISTS baski_onay_prepared_at      TIMESTAMPTZ;
