-- 059 — Repair ozalit approval JSONB columns written as `{}`
--
-- `patchProject` used to bind these two JSONB columns as raw JS values.
-- node-postgres encodes a JS array as a Postgres ARRAY LITERAL, not as JSON:
--   [{ id: 'u1', ... }]  ->  {"{\"id\":\"u1\",...}"}   -> 22P02, a 500 out of
--                                                          POST /projects/:id/approve
--   []                   ->  {}                        -> accepted, but stores
--                                                          an empty OBJECT
-- The first case never persisted anything (the transaction rolled back), so
-- the only bad data on disk is the second: rows whose approval column holds
-- `{}` (or any other non-array) instead of `[]`. Those rows make
-- `jsonb_array_length` raise 22023, which took down reconcileOzalitApprovals.
--
-- patchProject now casts through `::jsonb` (PROJECT_JSONB_COLUMNS), so no new
-- rows can land in this state. This normalises the existing ones.
-- Idempotent: re-running matches nothing.

UPDATE projects
   SET ozalit_approvals = '[]'::jsonb
 WHERE jsonb_typeof(ozalit_approvals) IS DISTINCT FROM 'array';

UPDATE projects
   SET ozalit_designer_approvals = '[]'::jsonb
 WHERE jsonb_typeof(ozalit_designer_approvals) IS DISTINCT FROM 'array';
