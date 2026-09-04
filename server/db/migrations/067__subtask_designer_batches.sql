-- 067 — subtask_pages → subtask_designer_batches: per-designer session log.
--
-- Designers don't ship pages in one atomic "done" — they sit down, work
-- through a batch, save, and a tickbox appears in the team's daily log.
-- Each save is ONE entry; the running total `subtasks.pages_done` is the
-- SUM of every entry's `pages`.
--
-- Why batches, not a single overwritable per-designer count:
-- • The previous "set pages_done = N" shape was destructive: the
--   designer typing "2" then later "3" replaced the 2 with a 3, and
--   the day's first batch of work silently vanished from the audit.
-- • The team's daily cadence (who shipped what when) is invisible
--   without per-batch rows. The team leader scrolls the project
--   timeline trying to figure out why progress was at 17 yesterday and
--   28 today.
-- • "Yeniden Çalıştım" belongs to ONE batch, not the whole subtask.
--   A designer who redid the work at pages 30-32 wants that on the
--   specific batch, not on the whole book's audit trail.
--
-- Storage trade-offs:
-- • We append, we don't update. The trigger keeps `pages_done` /
--   `is_done` on `subtasks` in sync, so the rest of the schema
--   (progress bar, advance gating, demo readiness) reads a single
--   derived column without a join.
-- • One row per save means a high-volume day can have many rows; the
--   index below on (subtask_id, created_at DESC) keeps the list-page
--   SELECT cheap.
--
-- Idempotent: re-running on a DB that already has the new shape is a
-- no-op (every CREATE uses IF NOT EXISTS, DROP uses IF EXISTS). Catches
-- the case where a previous apply of this migration left the legacy
-- `subtask_designer_counts` table behind — that DROP runs only when the
-- table exists, so a fresh DB and a re-applied DB both end up clean.
--
-- The `pages > 0` CHECK keeps a fat-fingered zero or negative entry out
-- of the table; the route's per-batch cap (`pages <= total_pages`) is a
-- softer business rule enforced in JS, not via CHECK, so a leader can
-- still raise `total_pages` mid-stream without orphaning prior batches.
DROP TABLE IF EXISTS subtask_designer_counts CASCADE;

CREATE TABLE IF NOT EXISTS subtask_designer_batches (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  subtask_id    TEXT        NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  designer_id   TEXT        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  pages         INTEGER     NOT NULL
                            CHECK (pages > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The "Yeniden Çalıştım" stamp: who/when last touched the batch again.
  -- Null = never re-touched. Once set, stays set — the audit trail
  -- records the FIRST re-touch; further clicks are idempotent no-ops
  -- (the route exposes this as a 200 with the same row back).
  redone_at     TIMESTAMPTZ,
  redone_by     TEXT        REFERENCES users(id) ON DELETE SET NULL,
  redone_by_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_subtask_designer_batches_subtask
  ON subtask_designer_batches (subtask_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subtask_designer_batches_designer
  ON subtask_designer_batches (designer_id, created_at DESC);

-- Trigger: on every INSERT/UPDATE/DELETE on the batches table, recompute
-- subtasks.pages_done (sum across batches) and subtasks.is_done.
CREATE OR REPLACE FUNCTION recompute_subtask_pages_counter(p_subtask_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_sum   INTEGER;
  v_total INTEGER;
BEGIN
  SELECT COALESCE(SUM(pages), 0) INTO v_sum
    FROM subtask_designer_batches
   WHERE subtask_id = p_subtask_id;
  SELECT COALESCE(total_pages, 0) INTO v_total
    FROM subtasks
   WHERE id = p_subtask_id;
  UPDATE subtasks
     SET pages_done = v_sum,
         is_done    = (v_total > 0 AND v_sum >= v_total),
         updated_at = NOW()
   WHERE id = p_subtask_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION subtask_designer_batches_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recompute_subtask_pages_counter(OLD.subtask_id);
    RETURN OLD;
  END IF;
  PERFORM recompute_subtask_pages_counter(NEW.subtask_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_subtask_designer_batches ON subtask_designer_batches;
CREATE TRIGGER trg_subtask_designer_batches
  AFTER INSERT OR UPDATE OR DELETE ON subtask_designer_batches
  FOR EACH ROW EXECUTE FUNCTION subtask_designer_batches_trigger();

-- Backfill from the previous run's `subtasks.pages_done` (the only
-- pre-existing source of "how many pages this designer shipped"). One
-- batch per kind='pages' subtask with a positive count, attributed to
-- the subtask's primary designer (or the project primary as fallback).
-- The trigger runs on every INSERT and lands the sum back on the
-- subtasks row as the post-write state.
--
-- Idempotent on a re-run: the NOT EXISTS guard skips subtasks that
-- already have at least one batch. Without it, a re-applied migration
-- would double-count: the trigger recomputes pages_done to (old sum) +
-- (backfilled pages_done), every time. The guard makes the backfill a
-- one-shot that runs only on freshly-migrated DBs.
INSERT INTO subtask_designer_batches (subtask_id, designer_id, pages)
SELECT s.id,
       COALESCE(s.assigned_to, p.assigned_to),
       s.pages_done
  FROM subtasks s
  JOIN projects  p ON p.id = s.project_id
 WHERE s.kind = 'pages'
   AND s.pages_done > 0
   AND COALESCE(s.assigned_to, p.assigned_to) IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM subtask_designer_batches b
      WHERE b.subtask_id = s.id
   );

-- Drop the legacy chip-grid table. Indexes and any FK constraints
-- cascade with the table; nothing else in the schema depends on it
-- after the route removals ship.
DROP TABLE IF EXISTS subtask_pages CASCADE;
