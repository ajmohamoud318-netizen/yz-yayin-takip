-- 023 — sessions
--
-- Server-side session store backing the httpOnly session cookie that
-- replaces the trusted `X-User-Id` header (see SECURITY_PLAN.md P0).
--
-- A session is an opaque random token (nanoid, minted in Node) mapped to
-- a user with an absolute expiry. The token lives ONLY in an httpOnly
-- cookie, so client JS can neither read nor forge it. Logout and
-- deactivation delete rows here, which immediately invalidates the
-- credential — something the old header auth could never do.
--
-- ON DELETE CASCADE: deleting a user (hard delete in users.js) also drops
-- their sessions, so a deleted account can't keep an active session.

CREATE TABLE sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
