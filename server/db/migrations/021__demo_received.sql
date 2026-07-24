-- 021 — demo "received" acknowledgment
--
-- Before a delivered demo can be approved (demo_onay / cin_demo_onay), at least
-- one assigned designer OR the team leader must mark it "Teslim Alındı"
-- (received). This is a gate one step before the Onay: the approve is refused
-- until demo_received is TRUE. The flag is reset each time a fresh demo is
-- delivered into demo_onay (see computeDemoTeslimAdvance), so every demo round
-- needs its own acknowledgment. Ozalit is intentionally NOT gated.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS demo_received     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS demo_received_by  TEXT,
  ADD COLUMN IF NOT EXISTS demo_received_at  TIMESTAMPTZ;
