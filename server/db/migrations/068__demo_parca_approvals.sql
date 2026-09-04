-- 068 — Demo per-parça approval ledger
--
-- The demo_onay / cin_demo_onay stage advances only when the team leader has
-- approved every parça the designer put on the demo sheet. Today
-- computeApproval's demo branch only checks progress === 100% — a single
-- approve click moves the project off the gate even when the latest demo
-- snapshot's _selectedComponents lists several parçalar and only one was
-- actually inspected. This ledger is the gate the gate has been missing:
-- project.advance fires only when every parça in the snapshot has an entry.
--
-- Shape:
--   demo_parca_approvals: [ { parca, by, by_name, at } ]   -- who approved what
--   demo_parca_rejections: [ { parca, by, by_name, at, reason, target } ]
--     target is 'designer' (spec error) or 'matbaa' (print defect), same
--     convention as the project-level reject. Already-approved parçalar stay
--     locked when one is rejected (partial rejection — see memory 8f1330ef).
--
-- Why JSONB on projects rather than a per-demo row: the demo round's parça
-- list is whatever the latest snapshot's _selectedComponents carries, and
-- advancing only depends on the set-vs-ledger comparison. A separate table
-- would just mirror the project row, so a column is enough and keeps the
-- advance write inside the same UPDATE.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS demo_parca_approvals  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS demo_parca_rejections JSONB NOT NULL DEFAULT '[]'::jsonb;