-- 067 — subtask_pages → subtask_designer_counts: redesign the per-page work
-- state into per-designer slot counts.
--
-- The "İç Sayfalar" subtask used to be tracked page-by-page (subtask_pages),
-- surfaced in the UI as a chip grid where the designer marked each page
-- done one chip at a time. Designers now enter the page count they shipped
-- in a number input per assigned designer — the chip grid is gone.
--
-- The new shape keeps one row per assigned designer on the subtask and
-- sums them on the parent row:
--
--   subtask_designer_counts (subtask_id, designer_id, pages_done)
--
-- `subtasks.pages_done` and `subtasks.is_done` become derived columns
-- maintained by a trigger (kept as concrete columns for the same reason
-- they exist today: the project progress bar and `progressFor` JS read
-- them directly, and the rest of the code would otherwise need a join
-- on every read).
--
-- The chip-grid helpers (`loadSubtaskPages`, `setSubtaskPage`,
-- `seedSubtaskPages`, `pruneSubtaskPages`, `assignSubtaskPage`,
-- `resyncSubtaskPageAssignments`) and their routes (PATCH …/pages/:idx,
-- PATCH …/pages/:idx/assign, POST …/pages/bulk-assign) are removed in
-- the same change set.
--
-- Idempotent: re-running on a DB that already has the new shape is a
-- no-op — every CREATE uses IF NOT EXISTS, every DROP uses IF EXISTS,
-- the backfill is ON CONFLICT DO UPDATE.

CREATE TABLE IF NOT EXISTS subtask_designer_counts (
  subtask_id    TEXT    NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  designer_id   TEXT    NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  pages_done    INTEGER NOT NULL DEFAULT 0
                CHECK (pages_done >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subtask_id, designer_id)
);

CREATE INDEX IF NOT EXISTS idx_subtask_designer_counts_designer
  ON subtask_designer_counts (designer_id);

-- Trigger function: recompute `subtasks.pages_done` (sum across designers)
-- and `subtasks.is_done` (sum ≥ total_pages) on every write.
--
-- `pages_done` and `is_done` stay concrete columns rather than GENERATED
-- ALWAYS AS so progressFor (client + server) reads them with no join and
-- the migration's existing callers continue to work unchanged.
CREATE OR REPLACE FUNCTION recompute_subtask_pages_counter(p_subtask_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_sum   INTEGER;
  v_total INTEGER;
BEGIN
  SELECT COALESCE(SUM(pages_done), 0) INTO v_sum
    FROM subtask_designer_counts
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

CREATE OR REPLACE FUNCTION subtask_designer_counts_trigger()
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

DROP TRIGGER IF EXISTS trg_subtask_designer_counts ON subtask_designer_counts;
CREATE TRIGGER trg_subtask_designer_counts
  AFTER INSERT OR UPDATE OR DELETE ON subtask_designer_counts
  FOR EACH ROW EXECUTE FUNCTION subtask_designer_counts_trigger();

-- Backfill from existing `subtasks.pages_done`. For every kind='pages'
-- subtask with a positive pages_done, attribute the legacy count to the
-- subtask's assigned designer (or the project primary as fallback), so
-- the new trigger sees consistent state from the first query onward.
--
-- Live data was cleared by the operator before this migration landed, so
-- in practice this is a no-op, but it's safe to run on a populated DB
-- (the trigger will recompute pages_done / is_done back to the summed
-- value as each row is backfilled).
INSERT INTO subtask_designer_counts (subtask_id, designer_id, pages_done)
SELECT s.id,
       COALESCE(s.assigned_to, p.assigned_to),
       s.pages_done
  FROM subtasks s
  JOIN projects  p ON p.id = s.project_id
 WHERE s.kind = 'pages'
   AND s.pages_done > 0
   AND COALESCE(s.assigned_to, p.assigned_to) IS NOT NULL
ON CONFLICT (subtask_id, designer_id) DO UPDATE
   SET pages_done = EXCLUDED.pages_done,
       updated_at = NOW();

-- Drop the legacy chip-grid table. The indexes created on it (055,
-- 056, 057) and any FK constraints referencing it cascade with the
-- table; nothing else in the schema depends on it after the route
-- removals ship.
DROP TABLE IF EXISTS subtask_pages CASCADE;
