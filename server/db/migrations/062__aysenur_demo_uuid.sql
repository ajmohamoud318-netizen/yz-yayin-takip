-- 062 — codify Ayşenur's seeded UUID prefix
--
-- Why this exists: migration 009 originally seeded the team-leader demo
-- row with id '00000000-0000-0000-0000-0000000000a1' (idempotent INSERT
-- ... ON CONFLICT DO NOTHING). The file was later edited in commit
-- 6dca88b (a feat(progress) sweep) to use '785ea3f9-0000-0000-0000-
-- 000000000000', but the line change was incidental and was never run
-- forward — the local dev DB had the new id and Dokploy still has the
-- old one (see commit 569d17e, where the email change followed the
-- same pattern).
--
-- After Path A's boot-time checksum guard landed, the file had to be
-- reverted to its applied state ('00000000-...a1') so the boot-time
-- `assertAppliedChecksums` check would pass. This forward migration
-- brings live databases up to the post-apply reality without leaking
-- the edit into the history of 009.
--
-- Idempotent on both observed DB states:
--   • Local dev DB: row already has id '785ea3f9-0000-0000-0000-
--     000000000000', UPDATE matches 0 rows, no-op.
--   • Dokploy prod (or any fresh DB after 009 inserted the old id):
--     UPDATE re-keys the row from '00000000-...a1' to '785ea3f9-...0000'.
--
-- No foreign keys reference the id in this DB, so the re-key is safe.

UPDATE users
SET id = '785ea3f9-0000-0000-0000-000000000000'
WHERE id = '00000000-0000-0000-0000-0000000000a1';
