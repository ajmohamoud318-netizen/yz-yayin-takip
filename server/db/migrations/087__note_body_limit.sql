-- 087 — Notes can carry inline images (gallery URLs) plus richer HTML, so
-- the 2000-char body cap from 042 is too tight. Align the CHECK with the
-- API schema (20000).

ALTER TABLE target_project_idea_notes
  DROP CONSTRAINT IF EXISTS target_project_idea_notes_body_check;

ALTER TABLE target_project_idea_notes
  ADD CONSTRAINT target_project_idea_notes_body_check
  CHECK (length(btrim(body)) BETWEEN 1 AND 20000);
