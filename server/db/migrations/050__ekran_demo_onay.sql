-- 050 — Ekran Demo Onayı (on-screen demo approval)
--
-- A held demo (approved at <100%, see migration 021's demo_held) normally
-- requires a full physical re-demo round once the designer finishes: Demo
-- İste → matbaa delivers → leader approves again. That round-trip is pure
-- overhead when nothing physical needs re-printing — the design just needed
-- to reach 100%. This adds a lightweight alternative, mirroring the
-- sipariş pipeline's `ekran_onay` (migration 046): a single team-leader
-- digital click, no matbaa involvement, no receipt gate, no multi-party
-- ledger.
--
-- ekran_demo_requested_* — set when the leader/assigned designer asks for
-- an on-screen approval instead of a physical re-demo (only valid on a
-- held demo at 100% progress). Presence of ekran_demo_requested_at IS the
-- pending flag, same convention as demo_change_requested_at (048).
-- Approving it (computeEkranDemoApprove) clears these and advances the
-- project exactly like a normal demo approval would. Rejecting it
-- (computeEkranDemoReject) clears these and leaves the project exactly
-- where it was — the leader/designer falls back to the existing physical
-- Demo İste button.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ekran_demo_requested_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ekran_demo_requested_by        TEXT,
  ADD COLUMN IF NOT EXISTS ekran_demo_requested_by_name   TEXT;
