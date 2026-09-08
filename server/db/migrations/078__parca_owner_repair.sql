-- 078 — repair parça rows stranded with no owner
--
-- `upsertParcaState` writes `owner_role` and `route` VERBATIM rather than
-- COALESCE-ing them (migration 074): a parça returning to the approval gate has
-- to be able to CLEAR its owner, and the only way to express that through the
-- upsert is for an omitted field to mean null. Every patch that leaves the
-- parça on somebody's desk therefore has to restate the pair.
--
-- Three of migration 077's patches did not:
--
--   parcaChangeRequestPatch  — the leader asks; the parça stays with the matbaa
--   parcaChangeDeclinePatch  — the matbaa says no; it stays with them
--   parcaFixSettledPatch     — the correction lands; it is still their job
--
-- Each one handed the row to nobody. The consequences compound, because
-- `canActOnParca` reads exactly that column:
--
--   • The matbaa's queue (`listParcaStateByOwner('printer')`) stopped
--     returning the row, and `deriveTeslimParcalar` rebuilt a synthetic card
--     from the round's snapshot in its place — one carrying no change-request
--     fields, so the printer was shown an ordinary "Teslim Edin" and never saw
--     the question they were being asked.
--   • "İşlemi Başlatın" and "Teslim Edin" both fail with "Bu parça sizde
--     değil." on a parça that is unmistakably theirs — a dead end with no way
--     out from any screen, for either party.
--
-- The code is fixed, but rows written by the broken version stay broken: they
-- are unreachable by every actor and no transition can move them, so nothing
-- in the app will ever heal them. This does.
--
-- The repair is derivable, which is why it is safe to do in SQL. `state`
-- already says whose desk the parça is on — that is the column's entire job —
-- so the owner is read back from it rather than guessed:
--
--   with_matbaa / in_round → the matbaa holds it       → printer
--   with_designer          → the designer has it       → designer
--
-- `pending` and `approved` are deliberately untouched: a NULL owner is CORRECT
-- for those. A parça standing at the gate is on nobody's desk — that is what
-- makes it the leader's call — and re-owning it would put finished work back
-- into somebody's queue.
--
-- `route` is restored to 'physical' only where it is null AND the parça is with
-- the matbaa, because that is the only route that can put it there: an 'ekran'
-- round skips the printer entirely (`parcaRequestRoundPatch`). A designer's row
-- keeps whatever route it had, including none.
--
-- Idempotent: re-running matches no rows once they are repaired.

UPDATE parca_state
   SET owner_role = CASE state
                      WHEN 'with_matbaa'   THEN 'printer'
                      WHEN 'in_round'      THEN 'printer'
                      WHEN 'with_designer' THEN 'designer'
                    END,
       route      = CASE
                      WHEN route IS NOT NULL THEN route
                      WHEN state IN ('with_matbaa', 'in_round') THEN 'physical'
                      ELSE route
                    END,
       updated_at = NOW()
 WHERE owner_role IS NULL
   AND state IN ('with_matbaa', 'in_round', 'with_designer');
