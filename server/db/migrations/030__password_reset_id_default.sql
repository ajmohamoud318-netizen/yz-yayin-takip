-- 030 — password_resets.id default
--
-- Same bug as 013 (subtasks.id): password_resets.id is TEXT PRIMARY KEY
-- with no default, but createPasswordReset() in services/password-resets.js
-- inserts only (user_id, token, expires_at). Every INSERT therefore failed
-- with a not-null violation, so POST /api/auth/forgot-password returned 500
-- for any address that matched a real, active user.
--
-- The invitations table this service mirrors (007) already declares
-- `id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text`; 010 just dropped
-- the DEFAULT clause. Give the column the same default.

ALTER TABLE password_resets
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
