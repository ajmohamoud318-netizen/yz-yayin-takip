-- 013 — subtasks.id default
--
-- subtasks.id is TEXT PRIMARY KEY with no default, but the insert sites in
-- routes/projects.js (project create) and routes/subtasks.js (subtask PUT)
-- never supply an id. Every INSERT therefore failed with a not-null
-- violation and rolled back the whole create-project transaction.
-- Give the column the same gen_random_uuid()::text default the other
-- append-only tables (stage_history, subtask_updates, order_history) use.

ALTER TABLE subtasks
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
