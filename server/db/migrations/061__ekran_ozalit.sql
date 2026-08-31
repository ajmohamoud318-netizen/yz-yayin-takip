-- 061 — Ekran Ozalit: a screen route for the post-revize ozalit round
--
-- When a leader rejects an ozalit back to the designer, the resubmit used to
-- have exactly one destination: `ozalit_teslim`, i.e. another physical proof
-- from the matbaa. The sipariş pipeline already offered the designer a choice
-- at the equivalent moment — `_resolveAdvanceTarget` (domain/entities/Order.js)
-- makes a resubmit after a designer rejection pick between `tasarimci_onay`
-- (physical) and `ekran_onay` (screen). This brings the project pipeline in
-- line: the designer who did the revision decides whether it warrants another
-- physical round or just a look at the screen.
--
-- Modelled as a FLAG on the existing `ozalit_onay` stage rather than a new
-- stage, exactly like Ekran Demo Onayı (migration 050): the stage pipeline
-- arrays, StageBar and the stage CHECK constraint all stay untouched, and the
-- round is still an ozalit round — it just skipped the matbaa.
--
-- An ekran ozalit is signed off by a SINGLE team leader (matching the sipariş
-- pipeline's flat `ekran_onay` step and the project's own Ekran Demo Onayı),
-- not by the multi-party leader+designer ledger a physical ozalit needs. It
-- also has no "Teslim Alındı" receipt gate — nothing physical arrives.
--
-- Reset to FALSE whenever the ozalit round ends (approved, or rejected into a
-- new round), so the flag never leaks from one round into the next.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ekran_ozalit BOOLEAN NOT NULL DEFAULT FALSE;
