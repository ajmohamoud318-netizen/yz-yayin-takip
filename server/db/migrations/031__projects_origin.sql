-- 031 — legacy/backlist provenance
--
-- Books published before this system existed can't reach the Ürünler catalog:
-- projects always start at 'tasarim', so a 2019 backlist title would have to be
-- walked through fake demos and a full multi-party ozalit approval just to
-- become orderable. `POST /api/projects/import` creates them directly at a
-- finished stage instead (see AGENTS.md → "Kayıtlı ürünler (legacy)").
--
-- Those rows have no subtasks, no designer and no demo/ozalit history, so they
-- must not be counted as live pipeline work: without this flag the dashboards
-- (AppShell counts, PeriodWidget's "N / total satışta") silently start
-- describing the backlist instead of the current period.
--
-- DEFAULT 'pipeline' means every existing row is already correct — no backfill.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'pipeline'
    CHECK (origin IN ('pipeline','legacy'));

CREATE INDEX IF NOT EXISTS idx_projects_origin ON projects (origin);
