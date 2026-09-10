-- 082 — Sticker is logged the way İç Sayfalar is
--
-- The two numbered subtasks have always been twins — "Toplam iç sayfa" and
-- "Toplam sticker adedi" sit side by side in NewProjectDialog — but only the
-- pages grew up. İç Sayfalar became a per-designer session log (migrations
-- 067/071/072): each save is a numbered range, "Ayşe sayfa 1-5 ekledi", and a
-- trigger keeps the running total and the done flag on the subtask. Sticker
-- was left behind as a bare checkbox that only ever writes `is_done`.
--
-- That checkbox also broke progress. Since the ratio change (6dca88b) a
-- sticker-count subtask contributes `stickers_done / total_stickers`, and
-- nothing in the app writes `stickers_done` any more — so a ticked Sticker
-- counted 0%, and a project with stickers could never reach the 100% that
-- ozalit and production require.
--
-- From here Sticker uses the same batch table, the same route and the same
-- input. The batch's `pages` / `start_page` columns keep their names and mean
-- "items" for a sticker row: sticker 1-5 is start_page 1, pages 5.
--
-- 1. The counter trigger learns the kind. A sticker row's batches sum into
--    `stickers_done` and close against `total_stickers`; every other kind is
--    untouched and still sums into `pages_done` against `total_pages`. The
--    function keeps its name because trg_subtask_designer_batches calls it.
--
-- 2. Backfill, so the switch loses nobody's work. A Sticker already ticked
--    done gets one batch covering 1..total_stickers, attributed the way 071
--    attributed pages (the subtask's designer, else the project's), stamped
--    when it was ticked. A row still carrying a pre-checkbox counter keeps
--    that count as 1..stickers_done. Rows with nothing to credit get nothing.
--    Without this a ticked Sticker would come to screen reading "0 / 24",
--    and the first batch logged on it would un-tick it.
--
-- 3. Refresh the stored progress of the projects the backfill touched. The
--    advance gate reads `projects.progress`, not a live recompute, so a
--    project whose Sticker just became 100% would otherwise stay stuck below
--    the gate until somebody happened to touch a subtask. The formula mirrors
--    server/src/domain/progress.js (average of per-subtask ratios, "Yazılım"
--    excluded) and skips the stages progressFor pins at 100.
--
-- Idempotent: CREATE OR REPLACE; the backfill skips any sticker row that
-- already has a batch; and the progress refresh recomputes the same value it
-- wrote the first time.

CREATE OR REPLACE FUNCTION recompute_subtask_pages_counter(p_subtask_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_sum   INTEGER;
  v_kind  TEXT;
  v_total INTEGER;
BEGIN
  SELECT COALESCE(SUM(pages), 0) INTO v_sum
    FROM subtask_designer_batches
   WHERE subtask_id = p_subtask_id;
  SELECT kind,
         COALESCE(CASE WHEN kind = 'sticker-count' THEN total_stickers ELSE total_pages END, 0)
    INTO v_kind, v_total
    FROM subtasks
   WHERE id = p_subtask_id;
  IF v_kind = 'sticker-count' THEN
    UPDATE subtasks
       SET stickers_done = v_sum,
           is_done       = (v_total > 0 AND v_sum >= v_total),
           updated_at    = NOW()
     WHERE id = p_subtask_id;
  ELSE
    UPDATE subtasks
       SET pages_done = v_sum,
           is_done    = (v_total > 0 AND v_sum >= v_total),
           updated_at = NOW()
     WHERE id = p_subtask_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

INSERT INTO subtask_designer_batches (subtask_id, designer_id, pages, start_page, created_at)
SELECT s.id,
       COALESCE(s.assigned_to, p.assigned_to),
       CASE WHEN s.is_done THEN s.total_stickers
            ELSE LEAST(s.stickers_done, s.total_stickers) END,
       1,
       CASE WHEN s.is_done THEN COALESCE(s.done_at, NOW()) ELSE NOW() END
  FROM subtasks s
  JOIN projects p ON p.id = s.project_id
 WHERE s.kind = 'sticker-count'
   AND s.total_stickers > 0
   AND (s.is_done OR s.stickers_done > 0)
   AND EXISTS (SELECT 1 FROM users u WHERE u.id = COALESCE(s.assigned_to, p.assigned_to))
   AND NOT EXISTS (
     SELECT 1 FROM subtask_designer_batches b
      WHERE b.subtask_id = s.id
   );

UPDATE projects p
   SET progress = calc.progress
  FROM (
    SELECT s.project_id,
           ROUND(100 * AVG(
             CASE
               WHEN s.kind = 'pages' AND COALESCE(s.total_pages, 0) > 0
                 THEN LEAST(1, GREATEST(0, s.pages_done::numeric / s.total_pages))
               WHEN s.kind = 'sticker-count' AND COALESCE(s.total_stickers, 0) > 0
                 THEN LEAST(1, GREATEST(0, s.stickers_done::numeric / s.total_stickers))
               WHEN s.is_done THEN 1
               ELSE 0
             END
           ))::int AS progress
      FROM subtasks s
     WHERE s.title <> 'Yazılım'
     GROUP BY s.project_id
  ) calc
 WHERE p.id = calc.project_id
   AND p.stage NOT IN ('ozalit_teslim', 'ozalit_onay', 'baski_onay', 'cin_baski_onay',
                       'baskida', 'gumruk', 'satista')
   AND EXISTS (
     SELECT 1
       FROM subtasks st
       JOIN subtask_designer_batches b ON b.subtask_id = st.id
      WHERE st.project_id = p.id
        AND st.kind = 'sticker-count'
   );
