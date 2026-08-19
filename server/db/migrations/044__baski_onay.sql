-- 044 — Baskı Onay Formu (final print-approval gate)
--
-- Inserts a new mandatory stage, 'baski_onay', between 'ozalit_onay' and
-- 'uretime_hazir' in the TR pipeline. Once every leader + assigned designer
-- has signed off on the ozalit, the project no longer jumps straight to
-- production — it lands here first, where a team leader reviews a form
-- pre-filled from the last ozalit sheet and gives the final "Baskı Onayı".
-- Only team_leader (Serpil Hanım, Ayşenur, …) may edit or approve it.
--
-- The form itself is stored as another `demos` row (kind = 'baski_onay'),
-- reusing the existing demo/ozalit sheet machinery rather than a new table.

ALTER TABLE projects DROP CONSTRAINT projects_stage_check;
ALTER TABLE projects ADD CONSTRAINT projects_stage_check CHECK (stage IN (
  'tasarim',
  'demo_teslim','demo_onay',
  'ozalit_teslim','ozalit_onay','baski_onay',
  'cin_demo_teslim','cin_demo_onay',
  'uretime_hazir','uretimde','gumruk','satista'
));

ALTER TABLE demos DROP CONSTRAINT demos_kind_check;
ALTER TABLE demos ADD CONSTRAINT demos_kind_check CHECK (kind IN ('demo','ozalit','baski_onay'));
