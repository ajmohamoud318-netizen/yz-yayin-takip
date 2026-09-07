-- 073 — Name the parça on a per-parça reject in the timeline
--
-- A per-parça reject (migrations 068/069/070) writes a stage_history row whose
-- only distinguishing content is `reason` and `reject_target`. The parça names
-- live exclusively in the projects.*_parca_rejections JSONB, which nothing
-- renders — so the timeline reads
--
--   "Parça bazlı red"
--
-- with no indication of WHICH parça was bounced, on a project whose whole point
-- is that its parçalar are handled separately. A leader reading the history of
-- a three-parça round cannot tell what happened.
--
-- `parca` carries the rejected names for exactly those rows. It is a plain
-- TEXT of comma-joined names rather than a FK or an array because parçalar are
-- name-keyed strings everywhere else in this codebase (sanitiseParcalar in
-- domain/transitions.js, parcaNames in the client's domain/services/pipeline.js)
-- — there is no parça entity to point at, and a rename must not rewrite
-- history. This column is a record of what was said at the time.
--
-- NULL on every other row: whole-round rejects and all non-reject events keep
-- meaning "the whole project", exactly as they do today.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE stage_history
  ADD COLUMN IF NOT EXISTS parca TEXT;
