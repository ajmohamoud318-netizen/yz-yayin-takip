-- 077 — parca_state: the change-request handshake, per parça
--
-- Correcting a sheet the matbaa is holding has always had two modes, and which
-- one applies depends on whether the printer has started:
--
--   not started → the leader edits it outright ("Gönderilen Demoyu Düzenleyin")
--   started     → the leader ASKS ("Değişiklik İste"); the matbaa accepts —
--                 which un-starts the round and owes a fix — or declines, and
--                 the leader waits for delivery.
--
-- Both modes read `projects.demo_started` / `ozalit_started`, and that is the
-- bug this migration closes. Migration 074 moved "has the matbaa started?" to
-- the parça (`started_at`), and `startParca` deliberately does NOT touch the
-- project-level flag — setting it because one parça started would hide
-- "İşlemi Başlatın" on every other parça the matbaa still owes. So on a split
-- round the project flag stays false forever, and with it:
--
--   • canEditSentDemoRequest kept offering the free edit, and computeDemoEdit
--     kept allowing it — the leader could silently rewrite the spec of a parça
--     the matbaa was physically producing, who got only a "form changed" ping.
--   • canRequestDemoChange (which needs the flag TRUE) never fired, so the
--     ask/accept/decline handshake was unreachable on exactly the rounds that
--     needed it most.
--
-- These columns are the per-parça counterparts of the project's
-- `*_change_requested_*` + `*_fix_pending` set, in the same shape as
-- `started_at` / `received_at` above them. One parça's handshake on the row
-- that already tracks whose desk it is on:
--
--   started_at set, no request      → locked; leader must ask
--   change_requested_at set         → asked; matbaa's move
--   fix_pending true, started_at    → accepted; leader owes the correction,
--     cleared                         and the matbaa may not re-start until
--                                     it lands (startParca's guard, mirroring
--                                     computeDemoStart's)
--
-- `fix_pending` is cleared by the leader's edit landing — the same thing
-- computeDemoEdit does with the project-level flag.
--
-- The project-level columns stay. They still own single-parça and legacy
-- rounds, where there is no parça row to carry the handshake.
--
-- Idempotent so re-running on a seeded DB is a no-op.

ALTER TABLE parca_state
  ADD COLUMN IF NOT EXISTS change_requested_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS change_requested_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS change_requested_by_name TEXT,
  ADD COLUMN IF NOT EXISTS change_requested_note    TEXT,
  ADD COLUMN IF NOT EXISTS fix_pending              BOOLEAN NOT NULL DEFAULT FALSE;
