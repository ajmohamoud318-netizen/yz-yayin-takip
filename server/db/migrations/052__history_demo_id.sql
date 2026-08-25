-- 052 — Point a history row at the exact spec-sheet snapshot it produced.
--
-- A correction to an already-sent demo/ozalit ("Gönderilen Demoyu
-- Düzenleyin") writes its snapshot to the round's NEXT attempt slot so the
-- as-first-sent sheet stays intact — see `willEditBump` in
-- client/src/components/SpecFormDialog.jsx. That works for one correction.
-- It does not work for two: an accepted change request (migration 049) lets
-- the leader edit the same round again, and that second correction lands in
-- the SAME slot. `demos` is append-only, so both versions are still stored —
-- but every lookup keyed by (project, kind, attempt) resolves to the newest
-- row, so the first correction became unreachable and its "Demo Formu
-- Güncellendi" timeline row opened the second one's content.
--
-- Nothing in the (project, kind, attempt) key can distinguish them, so the
-- history row now remembers WHICH snapshot it wrote. Rows written before
-- this migration keep demo_id NULL and fall back to the attempt lookup.
--
-- ON DELETE SET NULL, not CASCADE: losing a snapshot must never delete the
-- timeline row saying the edit happened.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE stage_history
  ADD COLUMN IF NOT EXISTS demo_id TEXT REFERENCES demos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_history_demo ON stage_history (demo_id);
