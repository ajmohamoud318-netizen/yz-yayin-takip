-- 019 — Multi-party ozalit approval
--
-- Ozalit onay now requires EVERY active team leader AND every assigned designer
-- to approve before the project advances to Üretime Hazır. Each approval is
-- recorded as an object { id, role, name, at } in this array; the transition
-- advances only once the array covers the full required set. A team-leader
-- rejection clears it.
--
-- Supersedes the single `ozalit_leader_approved` boolean from migration 011
-- (which stays for backward compatibility but is no longer used). Idempotent.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ozalit_approvals JSONB NOT NULL DEFAULT '[]'::jsonb;
