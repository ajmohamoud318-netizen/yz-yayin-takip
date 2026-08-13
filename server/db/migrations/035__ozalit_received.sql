-- 035 — ozalit "Teslim Alındı" acknowledgment
--
-- The demo flow has had a receipt gate since migration 021: a delivered demo
-- must be marked "Teslim Alındı" by an assigned designer or the team leader
-- before it can be approved, and "Teslim Alınamadı" is the escape hatch for
-- when it never arrived. Ozalit only ever got the escape hatch — migration 021
-- calls ozalit "intentionally NOT gated" — which left the physical ozalit proof
-- with a way to say "it never came" and no way to say "it's here". Ozalit now
-- mirrors demo exactly.
--
-- Set at ozalit_onay by a leader/assigned designer, reset every time the matbaa
-- delivers a fresh proof (computeOzalitTeslimAdvance) so each ozalit round needs
-- its own acknowledgment. Blocks computeOzalitOnayApproval until TRUE.
--
-- Not backfilled on purpose: projects already sitting at ozalit_onay start at
-- FALSE and their approvers acknowledge the proof once, like every round after
-- this one. The alternative (backfilling TRUE) would hide the new step on
-- exactly the projects the team is looking at today.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ozalit_received     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ozalit_received_by  TEXT,
  ADD COLUMN IF NOT EXISTS ozalit_received_at  TIMESTAMPTZ;
