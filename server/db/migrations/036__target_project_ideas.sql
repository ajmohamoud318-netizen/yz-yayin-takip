-- 036 — Hedef Projeler ("target project ideas")
--
-- A lightweight idea board on Baskı Listesi: designers and the team leader
-- jot down a book concept they've spotted (often a link to something seen on
-- Instagram / social media) before it becomes a real project. Deliberately
-- NOT part of the `projects` table — these have no pipeline, no stage, no
-- assignee. Turning one into a real project is a manual "Yeni Proje" later.
--
-- created_by is ON DELETE SET NULL, matching projects.created_by /
-- demos.created_by / order_requests.requested_by — shared team content
-- outlives its author leaving. created_by_name is a snapshot for exactly
-- that case, same pattern as projects.deleted_by_name.

CREATE TABLE IF NOT EXISTS target_project_ideas (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  notes            TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  link             TEXT CHECK (link IS NULL OR length(link) <= 2000),
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_target_project_ideas_created
  ON target_project_ideas(created_at DESC);
