-- 056 — subtask_pages.assigned_to: explicit per-page assignment for the
-- "İç Sayfalar" subtask. Before this column the only owner signal was
-- `done_by` (who actually marked the page done), which left two flows
-- unspeakable:
--
--   • Pre-allocation. The team leader wants to split a 48-page book
--     between Aylin (1-24) and Rahşan (25-48) before any work starts, so
--     neither designer accidentally picks up the other's pages. Without
--     assigned_to, the only way to express this was to seed a fake
--     `done_by` per page — which lied about completion and broke the
--     progress bar.
--
--   • Mid-flight reassignment. A leader reviewing the second demo might
--     see that pages 5, 8, 12 are sloppy because they were Aylin's pages
--     and Aylin is stretched thin, and want to give them to Rahşan
--     instead. Without assigned_to the only move was the sledgehammer
--     "reset every page to pending" — which threw away the 30 pages
--     that were fine.
--
-- `assigned_to` is the PLANNED owner; `done_by` stays as who actually
-- SHIPPED it. The two can legitimately diverge: a designer can mark
-- someone else's reassigned page done in an emergency, and the chip
-- grid still shows the right planned-vs-actual relationship.
--
-- `assigned_at` is the timestamp of the most recent assignment so the
-- chip-grid tooltip can surface "X tarafından atandı, 2 saat önce"
-- without joining stage_history.
--
-- The partial index covers the hot read path: the chip grid and the
-- "my pages" filter both query WHERE assigned_to = $user. Pages with
-- no assignee (the team leader hasn't split the work yet) are skipped.

ALTER TABLE subtask_pages
  ADD COLUMN IF NOT EXISTS assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_subtask_pages_assigned
  ON subtask_pages (subtask_id, assigned_to)
  WHERE assigned_to IS NOT NULL;
