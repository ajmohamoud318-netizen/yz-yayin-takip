-- 033 — "kaldırma": take a product out of the Ürünler catalog without deleting it
--
-- Until now the only way to stop Sales ordering a product was to soft-delete the
-- whole project (029) — which also removes it from every pipeline view, the
-- timeline and the dashboards. That's far too blunt for the actual need: a book
-- that is out of print, discontinued, or simply shouldn't be reordered this
-- period is still a real project with real history; it just must not appear in
-- the sipariş catalog.
--
-- The Ürün Bilgileri page's "Ürünü Sil" was never a delete either: it only
-- blanks `product_info.components`, which leaves the project (and its Ürünler
-- row) untouched — see AGENTS.md → "Ürünler kataloğu".
--
-- `catalog_hidden` is that missing middle ground. It gates ORDERABLE-stage
-- listing and `assertOrderable` only; the project keeps its stage, history and
-- assignees, and the team leader can put it back with one click.
--
-- DEFAULT FALSE means every existing row stays listed — no backfill.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS catalog_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS catalog_hidden_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS catalog_hidden_by TEXT REFERENCES users(id) ON DELETE SET NULL;

-- The Ürünler query is "orderable stages, not hidden"; a partial index on the
-- hidden rows keeps that filter cheap while staying tiny (few rows are hidden).
CREATE INDEX IF NOT EXISTS idx_projects_catalog_hidden
  ON projects (catalog_hidden) WHERE catalog_hidden;
