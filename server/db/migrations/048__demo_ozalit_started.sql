-- 048 — Matbaa "Başladım" gate + change-request flow for demo/ozalit
--
-- Today a mistaken demo/ozalit request has no way back except waiting for
-- the matbaa to deliver and then using Reddet, which bumps demo_attempt /
-- ozalit_attempt even though nothing was actually produced. This adds:
--
--   * demo_started / ozalit_started — a flag-only marker the printer sets
--     (computeDemoStart / computeOzalitStart) once they've begun physical
--     work, no stage change. While FALSE, the leader/assigned designer can
--     cancel outright (computeDemoCancel / computeOzalitCancel — back to
--     tasarim, deliberately NOT bumping the attempt counter) or edit the
--     sheet directly.
--
--   * demo_change_requested_* / ozalit_change_requested_* — once started,
--     a cancel/edit becomes a request the printer must accept (un-starts
--     the round, reopening free cancel/edit) or decline (round stays
--     started). Presence of *_change_requested_at IS the pending flag —
--     no separate boolean.
--
-- Reset to FALSE/NULL on every fresh printer round (delivery, not-received,
-- held-resend) so stale state from a prior round never blocks the next one.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS demo_started                    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS demo_started_at                 TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS demo_started_by                 TEXT,
  ADD COLUMN IF NOT EXISTS demo_started_by_name             TEXT,
  ADD COLUMN IF NOT EXISTS demo_change_requested_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS demo_change_requested_by        TEXT,
  ADD COLUMN IF NOT EXISTS demo_change_requested_by_name   TEXT,
  ADD COLUMN IF NOT EXISTS demo_change_requested_note      TEXT,
  ADD COLUMN IF NOT EXISTS ozalit_started                  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ozalit_started_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ozalit_started_by                TEXT,
  ADD COLUMN IF NOT EXISTS ozalit_started_by_name           TEXT,
  ADD COLUMN IF NOT EXISTS ozalit_change_requested_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ozalit_change_requested_by       TEXT,
  ADD COLUMN IF NOT EXISTS ozalit_change_requested_by_name  TEXT,
  ADD COLUMN IF NOT EXISTS ozalit_change_requested_note     TEXT;
