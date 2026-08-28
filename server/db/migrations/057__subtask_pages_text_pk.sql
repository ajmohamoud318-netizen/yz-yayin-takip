-- 057 — subtask_pages: align PK type with the rest of the schema
--
-- Migration 055 created subtask_pages with `id SERIAL PRIMARY KEY` — the
-- only table in the schema that uses an integer auto-increment instead of
-- `TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text`. The code never
-- references the integer ids directly (INSERTs omit the column and let the
-- default fire, SELECTs use subtask_id + page_index), so the type is
-- invisible to the application — but it breaks the uniformity of the
-- schema and makes ad-hoc debugging / exports slightly more awkward.
--
-- This migration converts the column to TEXT with the same default every
-- other append-only table uses. Existing integer ids are cast to their
-- text representation ('1' → '1', '42' → '42') so any foreign references
-- or log entries survive the change.
--
-- Idempotent: re-running on a DB where the column is already TEXT is a
-- no-op (ALTER COLUMN TYPE to the same type is a no-op in PostgreSQL).

ALTER TABLE subtask_pages
  ALTER COLUMN id TYPE TEXT USING id::TEXT,
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- SERIAL created this sequence; it is now orphaned after the type change.
DROP SEQUENCE IF EXISTS subtask_pages_id_seq;
