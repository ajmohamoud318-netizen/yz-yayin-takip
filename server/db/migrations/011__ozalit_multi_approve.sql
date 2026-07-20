-- 011 — Ozalit multi-approve + per-designer capability flag
--
-- Two related changes that together let YZ run Özalit approvals as
-- AND-of-two (team leader + special designer) instead of relying solely
-- on printers:
--
--   1. A new boolean capability on the user.   A `designer` with
--      `can_approve_ozalit = TRUE` is the "special designer" — they're
--      authorised to approve (and reject) at demo_onay / cin_demo_onay /
--      ozalit_onay, and to edit Ürün Bilgileri. Only the team_leader
--      can set this when inviting a designer.
--
--   2. Project-level fields to track the AND-of-two approval state.
--      `computeOzalitOnayApproval` in `server/src/domain/transitions.js`
--      already references these — the migration makes them real columns
--      so the data persists and the UI can render the awaiting/approved
--      chips per role.
--
-- Both are idempotent so the migration can run repeatedly without
-- breaking existing data.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_approve_ozalit BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ozalit_leader_approved      BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ozalit_leader_approved_by   TEXT,
  ADD COLUMN IF NOT EXISTS ozalit_leader_approved_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ozalit_designer_approvals   JSONB       NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_users_can_approve_ozalit
  ON users(can_approve_ozalit)
  WHERE can_approve_ozalit IS TRUE;
