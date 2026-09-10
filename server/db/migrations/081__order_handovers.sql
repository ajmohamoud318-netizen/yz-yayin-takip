-- 081 — Give a sipariş's print run its own teslim (handover) leg.
--
-- THE HOLE
--
-- Migration 060's gate ends a sipariş at `baskida`, and orders-service's
-- `approveBaskiOnayForm` flips the PROJECT to `baskida` only forward — a
-- reprint of a title already at `baskida`/`gumruk`/`satista` correctly leaves
-- the stage alone, because the book really is already printed or on sale.
--
-- The teslim leg never learned about any of that. `handovers` keys on
-- `project_id` alone and `assertHandoverEligible` demands the project be
-- sitting exactly on its handover stage (TR `baskida`, ÇİN `gumruk`). So for
-- the commonest reprint there is — more copies of a book that is selling —
-- the physical handover could not be raised at all:
--
--   • the project is at `satista`, so `canRequestHandover` is false and the
--     matbaa's Teslim Talepleri page offers nothing;
--   • the order is at `baskida`, which is terminal, so nothing closes it;
--   • the run itself is real and visible (BaskiListesi's "Yeni Baskılar"
--     section lists exactly these orders), it simply had no way to end.
--
-- The result was a print run that shipped and a system that never recorded
-- it: no teslim row, no receipt from satış, and an order stuck at `baskida`
-- for the life of the product.
--
-- THE SHAPE OF THE FIX
--
-- Migrations 053 (`demos.order_id`) and 080 (`parca_state.order_id`) both hit
-- the same wall and answered it the same way — hang a nullable `order_id` off
-- the project-scoped table:
--
--     NULL  → the project's own teslim (every row that already exists)
--     set   → one sipariş's print run
--
-- One table, one route, one queue, one set of pages keep serving both. This
-- is the third time, so it is the house pattern rather than a new idea.
--
-- WHY THE PARTIAL INDEX HAS TO SPLIT IN TWO
--
-- `uq_handovers_pending_per_project` enforced one pending teslim per project.
-- Widened naively it would be wrong in both directions:
--
--   • kept as-is, a reprint's pending teslim would block the project's own
--     (and vice versa) even though they are different physical deliveries;
--   • replaced with a plain (project_id, order_id) unique, the project rows —
--     where order_id IS NULL — would stop being constrained at all, because in
--     SQL two NULLs are never equal. That is the exact trap migration 080's
--     header spells out for parca_state.
--
-- So two partial uniques, one per pipeline, each restating its predicate so
-- ON CONFLICT can still infer it:
--
--   uq_handovers_pending_per_project  (project_id) WHERE pending AND order_id IS NULL
--   uq_handovers_pending_per_order    (order_id)   WHERE pending AND order_id IS NOT NULL
--
-- The order index keys on `order_id` alone, not on both columns: an order
-- belongs to exactly one project, so including project_id would let the same
-- order carry two pending teslims if a row ever held the wrong project_id —
-- precisely the corruption the constraint exists to prevent. Same reasoning,
-- same wording, as 080's note on `ux_parca_state_order`.
--
-- `project_id` stays NOT NULL on every row. A reprint's teslim still points at
-- the product it delivers, which is what keeps the timeline, the joins and the
-- notification titles working unchanged.
--
-- ON DELETE CASCADE matches `demos.order_id` and `parca_state.order_id`:
-- deleting an order takes its own teslim rows with it, and can never orphan a
-- project's.
--
-- `teslim_edildi` — THE ORDER'S REAL TERMINAL STATE
--
-- `baskida` meant "the paper is at the matbaa", and it was doing double duty as
-- "finished" only because nothing came after it. Now something does. The
-- status CHECK gains one value, appended rather than renamed so every existing
-- row and every history key stays valid:
--
--     baskida ──satış confirms the teslim──► teslim_edildi
--
-- It is reachable ONLY through `PATCH /handovers/:id/confirm`; there is no
-- ORDER_STEP_NEXT entry for `baskida`, so the generic /advance route still
-- refuses to move a finished order, exactly as it does today.
--
-- The DDL below is idempotent (IF NOT EXISTS / DROP + re-ADD throughout). The
-- BACKFILL at the end is NOT, and must not be re-run: it is a one-time
-- cut-off, and applying it later would close runs that are legitimately
-- waiting for their teslim. The runner's `_migrations` table is what
-- guarantees once — do not replay this file by hand.

ALTER TABLE handovers
  ADD COLUMN IF NOT EXISTS order_id TEXT REFERENCES order_requests(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_handovers_order ON handovers (order_id);

-- Replace the single pending-guard with one per pipeline. DROP first: the old
-- index has no order_id predicate, so leaving it in place would keep blocking
-- a reprint's teslim on a project that already has one pending.
DROP INDEX IF EXISTS uq_handovers_pending_per_project;

CREATE UNIQUE INDEX IF NOT EXISTS uq_handovers_pending_per_project
  ON handovers (project_id) WHERE status = 'pending' AND order_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_handovers_pending_per_order
  ON handovers (order_id) WHERE status = 'pending' AND order_id IS NOT NULL;

-- The order's terminal state. Drop + re-add with the full set (migration 066
-- rebuilt this same constraint the same way).
ALTER TABLE order_requests DROP CONSTRAINT IF EXISTS order_requests_status_check;
ALTER TABLE order_requests
  ADD CONSTRAINT order_requests_status_check
  CHECK (status IN (
    'atama_bekleniyor',
    'tasarimciya_atandi',
    'kontroller_tamam',
    'matbaa_ozalit_yapiyor',
    'ekran_onayinda',
    'imza_bekleniyor',
    'baski_onayi_bekleniyor',
    'baskida',
    'teslim_edildi',
    'rejected'
  ));

-- BACKFILL: every order that already reached `baskida` is declared delivered.
--
-- Without this, the feature's first effect would be a flood: the matbaa's
-- Teslim Talepleri page lists every order at `baskida` that has no teslim row,
-- and until today that was every completed reprint the shop has ever run. They
-- were physically handed over months ago, off-system, because there was no
-- system to hand them over in — asking the matbaa to raise a teslim for each
-- would be asking them to re-deliver history.
--
-- So the cut-off is drawn here: everything before this migration is settled,
-- everything after it goes through the teslim leg. No `handovers` rows are
-- invented to match — a teslim row means somebody actually raised and confirmed
-- one, and back-dating fake receipts under real users' names would put claims
-- in the audit log that nobody made.
--
-- The order timeline says so explicitly rather than letting the status change
-- appear from nowhere, and `signed_by_id` is NULL because no person did this.
INSERT INTO order_history (order_id, step, signed_by_id, notes)
SELECT id, 'teslim_edildi', NULL,
       'Teslim kaydı geriye dönük kapatıldı (bu özellik öncesi tamamlanan baskı)'
  FROM order_requests
 WHERE status = 'baskida';

UPDATE order_requests SET status = 'teslim_edildi' WHERE status = 'baskida';
