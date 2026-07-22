-- 015 — Demo "approve-but-hold" rule
--
-- The demo loop can run at any progress. When the team leader (or printer /
-- special designer) approves a demo whose design is <100%, the project
-- stays at demo_onay / cin_demo_onay and waits for a second demo round
-- once the designer finishes. These fields capture that "held" state so
-- the UI can show "Demo onaylandı — Ozalit bekleniyor" and the server
-- can gate the second-demo request on demo_held + progress=100.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS demo_held          BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS demo_held_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS demo_held_by_name  TEXT;
