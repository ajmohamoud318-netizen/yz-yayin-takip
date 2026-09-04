-- 069 — Ozalit per-parça approval ledger
--
-- The ozalit_onay stage requires every active team leader AND every assigned
-- designer to approve each parça the designer put on the ozalit sheet. Today
-- the project-level ozalit_approvals ledger (migration 019/038) records the
-- required set as a single flat array — one approve click from any party
-- moves toward advance, and a final multi-party gate happens at the end.
-- That collapses "the KUTU proof had a kerning bug, Aylin caught it" into
-- "the project proof has issues", losing the per-parça signal that lets a
-- designer rebuild just the KUTU and leave the KİTAP proof locked.
--
-- This ledger keeps the project-level gate's required set (every active
-- team leader + every assigned designer) but splits the ledger per parça:
--
--   ozalit_parca_approvals: { '<parca>': [ { id, role, name, at }, ... ] }
--     one entry per approver per parça. A parça is "approved" when its
--     array contains every required party. The project advances when every
--     parça in the latest ozalit snapshot's _selectedComponents is full.
--
--   ozalit_parca_rejections: [ { parca, by, by_name, at, reason, target } ]
--     mirror of demo_parca_rejections. Already-approved parçalar stay
--     locked when one is rejected (partial rejection — memory 8f1330ef).
--
-- The project-level ozalit_approvals column is kept as-is: route handlers
-- that don't need per-parça granularity still read it, and the reconciler
-- (services/project-repository.js#reconcileOzalitApprovals) keeps both
-- in sync after active-leader churn.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ozalit_parca_approvals  JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ozalit_parca_rejections JSONB NOT NULL DEFAULT '[]'::jsonb;