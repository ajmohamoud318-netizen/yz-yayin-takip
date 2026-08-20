-- 047 — Retire the separate "Üretime Hazır" step; matbaa acts straight from
-- "Baskıda" (formerly "Üretimde"), for both pipelines.
--
-- Renames 'uretimde' -> 'baskida' and collapses 'uretime_hazir' into it too:
-- the extra "printer clicks to take a ready project into production" step is
-- gone, so a project's print-approval gate now lands directly on the stage
-- the matbaa actually works from. TR's existing dual-approval 'baski_onay'
-- gate is unchanged in shape, just repointed at 'baskida'; ÇİN gains its own
-- mirror gate, 'cin_baski_onay' (same maker-checker rule, reusing the
-- baski_onay_prepared* columns and the demos.kind='baski_onay' sheet, since a
-- project only ever visits one pipeline).
--
-- 'uretime_hazir' isn't a purely historical value being renamed for tidiness
-- — it's the printer's live queue today, so real rows can be sitting there
-- at deploy time. Both it and 'uretimde' collapse into 'baskida' so nothing
-- becomes unreachable once the pipeline arrays drop the old values.
--
-- stage_history.from_stage/to_stage carry no CHECK constraint, so existing
-- history rows referencing 'uretime_hazir'/'uretimde' keep rendering fine
-- (STAGE_LABELS keeps both old keys for exactly this reason) — no backfill
-- needed there beyond the one audit note below.

INSERT INTO stage_history (project_id, from_stage, to_stage, action, event, note)
SELECT id, stage, 'baskida', 'system', 'stage_rename',
       'Aşama yeniden adlandırıldı: Üretime Hazır / Üretimde → Baskıda (migration 047)'
FROM projects WHERE stage IN ('uretime_hazir', 'uretimde');

UPDATE projects SET stage = 'baskida', updated_at = NOW()
WHERE stage IN ('uretime_hazir', 'uretimde');

ALTER TABLE projects DROP CONSTRAINT projects_stage_check;
ALTER TABLE projects ADD CONSTRAINT projects_stage_check CHECK (stage IN (
  'tasarim',
  'demo_teslim','demo_onay',
  'ozalit_teslim','ozalit_onay','baski_onay',
  'cin_demo_teslim','cin_demo_onay','cin_baski_onay',
  'baskida','gumruk','satista'
));

-- demos.kind and baski_onay_prepared* are deliberately NOT touched here —
-- 'baski_onay' is reused as the demos.kind value for cin_baski_onay's form
-- too, and the existing baski_onay_prepared/_by/_by_name/_at columns are
-- reused as-is for the same reason (see server/src/domain/transitions.js).
