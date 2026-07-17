-- 010 — password reset tokens
--
-- One-shot tokens for the forgot-password flow. Same shape as the
-- invitations table: token is opaque + unique, expires_at is a hard
-- deadline, used_at marks consumption.
--
-- 1-hour expiry is short on purpose — a leaked email + token pair is
-- only useful for an hour. After that the row stays for forensics but
-- is rejected on use.

CREATE TABLE password_resets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_password_resets_token ON password_resets(token);
CREATE INDEX idx_password_resets_user  ON password_resets(user_id);