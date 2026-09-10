-- 080 — Give the sipariş's ozalit round the same per-parça life the project's has.
--
-- Migrations 068/069/070 split the APPROVAL ledgers per parça, and 074 made the
-- parça the unit of ROUTING — whose desk it is on, where in its cycle. Every one
-- of them keyed on `project_id` alone. The sipariş pipeline therefore stayed
-- whole-order: one `ozalit_started` scalar for the entire sheet, one flat
-- `matbaa_approvals` list, and a reject that bounced every parça whether or not
-- it was the one at fault.
--
-- That is the same collapse migration 069 was written to undo. "The KUTU proof
-- had a kerning bug" became "the sipariş proof has issues", and the matbaa
-- reprinted a KİTAP nobody complained about.
--
-- The shape of the fix is migration 053's, not a new one. That migration gave
-- the sipariş its own SHEET by hanging a nullable `order_id` off `demos`:
--
--     NULL  → the project's own round (every row that already existed)
--     set   → a sipariş's round
--
-- and made every project-scoped read filter `order_id IS NULL`. `parca_state`
-- takes the same column for the same reason, so one table, one service and one
-- queue keep serving both pipelines. The alternative — a parallel
-- `order_parca_state` — would have duplicated ~1900 lines of routing whose
-- edge cases (the gate-scoped row lookup, the union seeding that replaced
-- pruneApprovalsToSnapshot, the receipt reset) were paid for once already.
--
-- WHY THE PRIMARY KEY HAS TO GO
--
-- `parca_state` was keyed PRIMARY KEY (project_id, parca). A primary key
-- cannot contain NULLs, so it cannot be widened to include a nullable
-- `order_id`. Two PARTIAL unique indexes replace it, one per pipeline:
--
--   ux_parca_state_project  (project_id, parca) WHERE order_id IS NULL
--   ux_parca_state_order    (order_id, parca)   WHERE order_id IS NOT NULL
--
-- This is stricter than a plain UNIQUE (project_id, order_id, parca) would
-- have been, and the difference is not academic. In SQL two NULLs are never
-- equal, so a three-column unique index containing a nullable column does NOT
-- constrain the rows where it is NULL — every project row would have been
-- free to duplicate, silently, and `upsertParcaState`'s ON CONFLICT would have
-- had nothing to arbitrate on.
--
-- Both indexes are inferrable as ON CONFLICT targets by restating their
-- predicate (`... ON CONFLICT (project_id, parca) WHERE order_id IS NULL`),
-- which is what services/parca-state-repository.js now does — one upsert path
-- per pipeline rather than one for both.
--
-- Note the order index keys on (order_id, parca) and NOT on all three columns.
-- An order belongs to exactly one project, so project_id is functionally
-- dependent on it; including it would let the same parça exist twice under one
-- order if a row ever carried the wrong project_id, which is precisely the
-- corruption the constraint is meant to prevent.
--
-- WHAT DOES NOT CHANGE
--
--   • `project_id` stays NOT NULL on every row. A sipariş's parça still points
--     at the product it belongs to — that is what lets the reçete stay shared
--     and project-scoped, exactly as migration 053 kept it for the sheet.
--
--   • `gate` keeps its CHECK (demo, ozalit). A sipariş has no demo leg, so its
--     rows are always 'ozalit'; the column stays as-is rather than growing a
--     third value, because the gate describes what KIND of round the parça is
--     cycling on, and a sipariş ozalit round is an ozalit round.
--
--   • The 068/069/070 project ledgers are untouched. The order gets its OWN
--     ledgers below, mirroring 069 and 070 column for column.
--
-- Idempotent so re-running on a seeded DB is a no-op.

-- ---------------------------------------------------------------------------
-- 1. parca_state gains the order dimension
-- ---------------------------------------------------------------------------

ALTER TABLE parca_state
  ADD COLUMN IF NOT EXISTS order_id TEXT REFERENCES order_requests(id) ON DELETE CASCADE;

-- The old PK, by whatever name it was created under. Dropping it by a guessed
-- name would fail on a DB where Postgres picked a different one, so it is
-- looked up from the catalog. `IF EXISTS` on the re-run: the second pass finds
-- no primary key on the table and does nothing.
DO $$
DECLARE
  pk_name TEXT;
BEGIN
  SELECT conname INTO pk_name
    FROM pg_constraint
   WHERE conrelid = 'parca_state'::regclass
     AND contype  = 'p';
  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE parca_state DROP CONSTRAINT %I', pk_name);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_parca_state_project
  ON parca_state (project_id, parca)
  WHERE order_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_parca_state_order
  ON parca_state (order_id, parca)
  WHERE order_id IS NOT NULL;

-- The sipariş's project page and its own gate both ask "every parça of THIS
-- order". ux_parca_state_order serves that from its leading column, but only
-- for rows where order_id IS NOT NULL — which is every row such a query wants,
-- so no second index is needed. This one serves the reverse: "does this project
-- have sipariş parçalar at all", asked by the project detail page when it
-- renders a title's orders alongside its own rounds.
CREATE INDEX IF NOT EXISTS idx_parca_state_order ON parca_state (order_id)
  WHERE order_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The sipariş's own per-parça ledgers
-- ---------------------------------------------------------------------------
--
-- Twins of migration 069's pair on `projects`, and read the same way:
--
--   ozalit_parca_approvals  { '<parca>': [ { id, role, name, at }, ... ] }
--     A parça is approved when its array holds every required party — every
--     active team leader plus every designer assigned to the ORDER (not to the
--     project: an order carries its own assignee_ids). The order advances out
--     of imza_bekleniyor when every parça in the round's sheet is full.
--
--   ozalit_parca_rejections [ { parca, by, by_name, at, reason, target } ]
--     Append-only. Already-approved parçalar stay locked when one is rejected,
--     which is the entire point — a sipariş reject used to reset the whole
--     order's ledger.
--
-- The flat `matbaa_approvals` column is deliberately KEPT. It is what
-- computeMatbaaOnayApproval reads for a single-parça order (the common case,
-- and the one every existing row is in), and retiring it would mean rewriting
-- that gate for orders that have no per-parça sheet to speak of. The per-parça
-- ledger takes over only when the round's sheet carries more than one parça —
-- the same "single-parça round keeps the old whole-sheet behaviour" rule
-- allParcalarDelivered already applies on the project side.
ALTER TABLE order_requests
  ADD COLUMN IF NOT EXISTS ozalit_parca_approvals  JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ozalit_parca_rejections JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Twin of migration 070's pair, for the sipariş's baski_onayi_bekleniyor gate.
-- Same maker-checker rule per parça: whoever PREPARED a parça's sheet may not
-- be the one who approves it, unless they are the only active team leader
-- left (the escape hatch that keeps a lone leader from stranding the order).
ALTER TABLE order_requests
  ADD COLUMN IF NOT EXISTS baski_parca_preparers JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS baski_parca_approvals JSONB NOT NULL DEFAULT '{}'::jsonb;
