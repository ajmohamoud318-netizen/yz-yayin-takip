-- 076 — parca_state: the receipt, per parça
--
-- "Teslim Alındı" is the leader's confirmation that the printed proof physically
-- reached them, and nothing may be approved before it (computeApproval /
-- computeRejection both refuse without it). It has always been a PROJECT-level
-- fact — `demo_received` / `ozalit_received` — because a round used to arrive in
-- one piece.
--
-- Migration 074 broke that assumption on the matbaa's side: parçalar are
-- delivered one at a time, and the project deliberately stays at its *_teslim
-- stage until the last one lands (`allParcalarDelivered`). The leader's side
-- never caught up. A KUTU that came back on Monday could not be received, could
-- not be approved and could not be rejected until KİTAP arrived on Thursday —
-- the leader saw nothing at all for it, only a notification saying it had been
-- delivered. That is the half of "let both parties work at once" that was
-- missing.
--
-- These three columns are the per-parça counterparts of `*_received*`, in the
-- same shape as `started_at` / `delivered_at` above them: one round's worth of
-- fact about ONE parça, on the row that already tracks whose desk it is on.
--
--   delivered_at set, received_at null → waiting for the leader's "Teslim Alın"
--   received_at set                    → approvable / rejectable on its own
--
-- Cleared on every leg that takes the parça away from the gate — a new delivery
-- owes a new receipt, exactly as a fresh whole-round delivery clears
-- `demo_received`. `upsertParcaState` writes these verbatim (like started_at /
-- delivered_at, and unlike the COALESCE'd fields), so any patch that does not
-- restate them clears them, which is what every one of those legs wants.
--
-- The project-level flags stay: they still gate single-parça and legacy rounds,
-- and the *_onay gate still asks for one at the end of the round.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE parca_state
  ADD COLUMN IF NOT EXISTS received_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS received_by_name TEXT;
