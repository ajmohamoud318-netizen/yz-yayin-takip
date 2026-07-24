-- 020 — product_info
--
-- Per-project product specification ("ürün bilgileri" / parçalar) used by the
-- Demo and Ozalit forms and the Ürün Bilgileri catalog page. This data used to
-- live ONLY in browser localStorage, keyed by project id — which meant the
-- spec was invisible to any other user or browser, and a project could show
-- the wrong spec if a stale/leftover override was keyed by its id. Persisting
-- it here makes the project ↔ spec link stable and shared across everyone.
--
-- One row per project. `components` is the same JSON shape the SPA already
-- uses: [ { component, date, fields: [ { k, v }, ... ] }, ... ]. Kept as JSONB
-- so the form can evolve without further migrations.

CREATE TABLE product_info (
  project_id  TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  components  JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
