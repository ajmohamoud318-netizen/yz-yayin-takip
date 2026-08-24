-- 051 — Matbaa "Başladım" gate + change-request flow for the sipariş
-- order's own ozalit round (tasarimci_onay), full parity with migrations
-- 048/049's demo_started/ozalit_started on `projects`.
--
-- Until now, once a reorder was advanced to tasarimci_onay ("Matbaaya
-- Gönderin"), there was no way back except waiting for the printer to
-- deliver and then rejecting — which bumps nothing (orders don't track an
-- attempt counter the way the main pipeline does) but still forces a full
-- delivery/receipt/reject round trip for what may have been a mistaken
-- request. This adds:
--
--   * order_requests.ozalit_started — a flag-only marker the printer sets
--     (computeOrderOzalitStart) once they've begun physical work, no status
--     change. While FALSE, the team leader can cancel outright
--     (computeOrderOzalitCancel — back to goruldu) or edit the product spec
--     directly (computeOrderOzalitEdit — history/notify only).
--
--   * order_requests.ozalit_change_requested_* — once started, a
--     cancel/edit becomes a request the printer must accept
--     (computeOrderOzalitChangeAccept — un-starts the round, reopening free
--     cancel/edit, and sets ozalit_fix_pending) or decline
--     (computeOrderOzalitChangeDecline — round stays started). Presence of
--     ozalit_change_requested_at IS the pending flag — no separate boolean.
--
--   * order_requests.ozalit_fix_pending — set TRUE only by
--     computeOrderOzalitChangeAccept (an accepted request now owes a fix).
--     Cleared by computeOrderOzalitEdit (the fix was submitted) or
--     computeOrderOzalitCancel (the request was withdrawn instead). While
--     TRUE, computeOrderOzalitStart refuses — the matbaa cannot re-lock the
--     round until one of those two happens.
--
-- Reset to FALSE/NULL whenever the order re-enters tasarimci_onay for
-- re-delivery (matbaa-not-received, a matbaa-target reject) so stale state
-- from a prior round never blocks the next one — same rule migration 048
-- applies to the main pipeline.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE order_requests
  ADD COLUMN IF NOT EXISTS ozalit_started                  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ozalit_started_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ozalit_started_by                TEXT,
  ADD COLUMN IF NOT EXISTS ozalit_started_by_name           TEXT,
  ADD COLUMN IF NOT EXISTS ozalit_change_requested_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ozalit_change_requested_by       TEXT,
  ADD COLUMN IF NOT EXISTS ozalit_change_requested_by_name  TEXT,
  ADD COLUMN IF NOT EXISTS ozalit_change_requested_note     TEXT,
  ADD COLUMN IF NOT EXISTS ozalit_fix_pending                BOOLEAN     NOT NULL DEFAULT FALSE;
