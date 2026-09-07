-- 068 — pin each "I shipped N pages" batch to a specific page range.
--
-- Pre-068 model: a batch row was anonymous. `pages = 5` meant "I shipped
-- 5 pages" but didn't say WHICH pages. Two designers could each ship
-- "+1" on different days and the running sum double-counted if the same
-- pages got touched twice. The check at insert time could cap the sum
-- against `total_pages` but had no way to detect overlap.
--
-- Post-068 model: every batch carries `start_page`. The new batch
-- covers the closed range [start_page, start_page + pages - 1]. The
-- route rejects any save whose range intersects an existing range, so
-- pages_done is now the COUNT OF DISTINCT PAGES COVERED, not just the
-- sum of batch sizes. The trigger still recomputes pages_done from
-- SUM(pages); the difference is that overlap is now refused upstream,
-- so the sum never double-counts.
--
-- Schema change:
--   • start_page INTEGER, nullable. Old rows are backfilled below; new
--     rows always set it. NULL is tolerated for the brief window a
--     re-applied migration might leave (a re-run is a no-op once the
--     backfill is done — see "Idempotent" at the bottom).
--   • CHECK (start_page IS NULL OR start_page >= 1) — values only.
--   • Index on (subtask_id, start_page) so the overlap probe is cheap
--     even with hundreds of batches per subtask.
--
-- The "Yeniden Çalıştım" flow stays unchanged: a redo still stamps a
-- whole batch row, not individual pages within it. Designers who need
-- to redo one page of a five-page batch retract the whole batch (or
-- the leader does it manually) — same trade-off as the pre-068 model.
--
-- Idempotent:
--   • ALTER TABLE … ADD COLUMN IF NOT EXISTS is a no-op on a re-run.
--   • The backfill below guards on start_page IS NULL, so re-runs skip
--     already-filled rows.
--   • The index uses IF NOT EXISTS.

ALTER TABLE subtask_designer_batches
  ADD COLUMN IF NOT EXISTS start_page INTEGER
    CHECK (start_page IS NULL OR start_page >= 1);

CREATE INDEX IF NOT EXISTS idx_subtask_designer_batches_subtask_start
  ON subtask_designer_batches (subtask_id, start_page);

-- Backfill existing rows: assign start_page chronologically per subtask.
-- Walking each subtask's batches in created_at order, the running
-- cumulative of `pages` is the assumed start of the next batch. The
-- backfill is best-effort — the pre-068 model had no notion of WHICH
-- pages, so this is a chronological guess. If the old work happened
-- out of order (page 15 logged before page 5), the backfilled
-- start_page for the second batch will be wrong, and the new overlap
-- check will let a duplicate log through for any genuinely-skipped
-- pages. The team leader can spot-fix from the UI by retracting and
-- re-logging — the per-page history makes it visible.
--
-- Skipped on rows that already have start_page set (re-run safety).
WITH ordered AS (
  SELECT
    b.id,
    SUM(b.pages) OVER (
      PARTITION BY b.subtask_id
      ORDER BY b.created_at, b.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS prev_cumulative
  FROM subtask_designer_batches b
  WHERE b.start_page IS NULL
)
UPDATE subtask_designer_batches b
   SET start_page = COALESCE(ordered.prev_cumulative, 0) + 1
  FROM ordered
 WHERE b.id = ordered.id
   AND b.start_page IS NULL;
