-- 083 — every sipariş gets a number within its book
--
-- A sipariş has no name of its own. It reprints its project, so every surface
-- that shows one shows the project's title — and a title with two live orders
-- on it (nothing stops satış raising a second while the first is printing)
-- puts two identical cards in the parça panel, two identical rows in every
-- list, and two teslim requests nobody can tell apart. The id is `o-<nanoid>`,
-- which is not something a person reads.
--
-- `order_no` counts a project's orders from 1, in the order they were raised:
-- "Sipariş #2" is the book's second reprint. Per project rather than global,
-- because the title already names the book — the number only has to tell its
-- orders apart, and a small one says how many reprints the book has had.
--
-- 1. Backfill in creation order (id breaks ties: rows inserted by one
--    statement share a created_at).
--
-- 2. A BEFORE INSERT trigger assigns the next number, so every writer gets
--    one without knowing about it — the app's insertOrder, the seed, and
--    every test fixture that inserts an order by hand. It locks the project
--    row first: two orders raised on one book at the same moment would
--    otherwise both read the same MAX and one would die on the unique index.
--    FOR NO KEY UPDATE, not FOR UPDATE, so the lock does not block the FOR
--    KEY SHARE that every foreign-key insert against the project takes.
--    Numbers are never reused: orders are only ever deleted by their
--    project's cascade, which takes the whole sequence with it.
--
-- 3. NOT NULL and UNIQUE (project_id, order_no), so a row the trigger missed
--    or a hand-written duplicate is refused rather than shown as two "#2"s.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; the backfill touches only NULL rows;
-- CREATE OR REPLACE / DROP TRIGGER IF EXISTS; CREATE UNIQUE INDEX IF NOT
-- EXISTS; SET NOT NULL on a column that already is one is a no-op.

ALTER TABLE order_requests ADD COLUMN IF NOT EXISTS order_no INTEGER;

UPDATE order_requests o
   SET order_no = n.rn
  FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) AS rn
      FROM order_requests
  ) n
 WHERE o.id = n.id
   AND o.order_no IS NULL;

CREATE OR REPLACE FUNCTION order_requests_assign_order_no()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.order_no IS NULL THEN
    PERFORM 1 FROM projects WHERE id = NEW.project_id FOR NO KEY UPDATE;
    SELECT COALESCE(MAX(order_no), 0) + 1 INTO NEW.order_no
      FROM order_requests
     WHERE project_id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_requests_order_no ON order_requests;
CREATE TRIGGER trg_order_requests_order_no
  BEFORE INSERT ON order_requests
  FOR EACH ROW EXECUTE FUNCTION order_requests_assign_order_no();

ALTER TABLE order_requests ALTER COLUMN order_no SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_order_requests_project_order_no
  ON order_requests (project_id, order_no);
