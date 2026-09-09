-- 079 — repair parça rows whose attempt was seeded from a snapshot slot
--
-- `parca_state.attempt` and `demos.attempt` are two different counters that
-- were being conflated at both of the places a parça row gets materialised
-- (`deriveTeslimParcalar` and `loadParcaForUpdate` in services/parca-service.js):
--
--   parca_state.attempt — this parça's ROUND NUMBER. Starts at 1 (the column
--                         default, migration 074) and is raised only by
--                         parcaRejectPatch, which does `currentAttempt + 1`.
--
--   demos.attempt       — a storage SLOT for sheet snapshots, deliberately
--                         offset: +1 for a new round, and +2 for an
--                         edit-and-notify save so the pristine as-first-sent
--                         snapshot stays intact at its own slot for
--                         ProjectHistory to link to (SpecFormDialog's
--                         `willEditBump`).
--
-- Seeding the first from the second meant a parça nobody had ever reworked came
-- out at 2 on a first round, and at 3 after any correction to the sent sheet.
-- The badge `{attempt}. tur` renders whenever attempt > 1 — so the matbaa's job
-- card, the leader's "Matbaadaki parçalar" panel and the returned-parça panel
-- all announced a rework round that never happened.
--
-- The code is fixed, but rows written by the broken version stay broken: no
-- transition recomputes this field, so nothing in the app will heal them.
--
-- The repair is derivable, which is what makes it safe to do in SQL.
-- `parcaRejectPatch` (domain/parca-routing.js) is the ONLY thing that raises
-- `attempt`, and it stamps `rejected_at` in the same patch — no other patch in
-- that file writes `attempt` or clears `rejected_at`. So:
--
--   attempt > 1 AND rejected_at IS NULL
--     → this parça has never been rejected, so its counter cannot have been
--       raised legitimately. The value can only have come from the bad seed.
--       Reset it to 1.
--
-- Rows with `rejected_at` set are left alone: their count is real, and it is the
-- one number that says how many times the parça has been round.
--
-- Idempotent: once repaired, the WHERE clause matches nothing.

UPDATE parca_state
   SET attempt    = 1,
       updated_at = NOW()
 WHERE attempt > 1
   AND rejected_at IS NULL;
