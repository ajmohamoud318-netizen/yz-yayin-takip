-- 049 — Block re-starting a demo/ozalit until an accepted change request is
-- actually fixed.
--
-- Migration 048 let the matbaa accept a cancel/edit request, which un-starts
-- the round (demo_started/ozalit_started back to false) so the leader/
-- designer can act on it. But nothing stopped the matbaa from immediately
-- re-clicking "İşlemi Başlatın" before any fix landed, silently closing the
-- window the accept had just opened.
--
--   * demo_fix_pending / ozalit_fix_pending — set TRUE only by
--     computeDemoChangeAccept / computeOzalitChangeAccept (an accepted
--     request now owes a fix). Cleared FALSE by computeDemoEdit /
--     computeOzalitEdit (the fix was submitted) or computeDemoCancel /
--     computeOzalitCancel (the request was withdrawn instead). While TRUE,
--     computeDemoStart / computeOzalitStart refuses — the matbaa cannot
--     re-lock the round until one of those two happens.
--
-- Reset to FALSE on every fresh printer round for the same reason
-- demo_started/ozalit_started are (see migration 048) — stale state from a
-- prior round must never block the next one.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS demo_fix_pending    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ozalit_fix_pending  BOOLEAN NOT NULL DEFAULT FALSE;
