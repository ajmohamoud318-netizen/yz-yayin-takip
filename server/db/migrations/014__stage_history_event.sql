-- 014 — extend stage_history with a fine-grained `event` identifier
--
-- Why: the existing `action` enum (`create|advance|approve|reject|system`) is
-- too coarse for the project timeline. Several distinct things log with
-- `action='system'`: handover confirmation, order transfer, order final,
-- subtask list update. The UI used to render them all with the same generic
-- icon. We add a free-form `event` text column so each route handler can
-- tag its entry with a short identifier (`subtask_done`, `demo_form`,
-- `handover_request`, `project_edit`, …) and the React timeline can switch
-- on `event` to pick the right icon + label.
--
-- Default `'general'` so older rows still render cleanly. The CHECK on
-- `action` is unchanged — `event` is descriptive metadata, not a state.

ALTER TABLE stage_history
  ADD COLUMN IF NOT EXISTS event TEXT NOT NULL DEFAULT 'general';

-- Index so future queries like "show every handover confirmation for project X"
-- don't seq-scan the whole table.
CREATE INDEX IF NOT EXISTS idx_history_event ON stage_history(event);
