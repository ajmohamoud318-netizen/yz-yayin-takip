-- 001 — users
--
-- Mirrors the four roles enforced by the client (team_leader, designer,
-- printer, satis). password is bcrypt-hashed (in Node, by bcryptjs); null
-- until an invitation is accepted (a passwordless / OAuth signup will
-- reuse this same column).
--
-- We use TEXT ids rather than UUIDs so the seeded fixtures ('u-ayse' etc.)
-- map 1:1 with the mock data the SPA has been built against. UUIDs can be
-- introduced later as opaque identifiers; the client only ever passes the
-- ID string it received from a previous endpoint.
--
-- NOTE: We deliberately do NOT `CREATE EXTENSION pgcrypto` here. On
-- PostgreSQL 13+, `gen_random_uuid()` is a built-in core function (no
-- extension required). `CREATE EXTENSION` would also require superuser
-- or explicit privileges that the Dokploy-managed `postgres` role does
-- not have — without that, the boot-time migration runner rolls back
-- every migration and the server crashes on start.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password      TEXT,
  role          TEXT NOT NULL
                CHECK (role IN ('team_leader','designer','printer','satis')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  invited_at    TIMESTAMPTZ,
  joined_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_active ON users(is_active);
