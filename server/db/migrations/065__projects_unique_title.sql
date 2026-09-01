-- 065 — one live project per title, healing whatever predates the rule
--
-- Supersedes 063 and 064, whose files are deleted. Those two refused to
-- install over data that already broke the rule, which is the wrong
-- behaviour for this app: MIGRATE_ON_BOOT=true in production means a
-- refusal isn't a failed migration, it's an API that never starts
-- listening and a Dokploy container that crash-loops. Duplicates were
-- legal until now, so the live catalog is exactly where they exist.
-- This migration therefore fixes the data instead of rejecting it.
--
-- WHY UNIQUE AT ALL
-- A project's only human-readable handle is its title: ids are `p-<nanoid>`
-- and never rendered, so two live projects called "Test" are
-- indistinguishable in every list, picker, order form and notification the
-- team sees. Reprints are already modelled on the *same* row (pass_number /
-- pass_kind, migration 002), so a second row with an existing title is a
-- double entry, not a second edition.
--
-- THE KEY
-- trim + collapse whitespace + fold all four Turkish i forms (i İ ı I) onto
-- 'i', matching normaliseProjectTitle in domain/project-title.js. The fold
-- matters because only a Turkish keyboard produces the dotted capital İ:
-- caps titles from a phone set to English, or pasted out of Excel, arrive as
-- "MATEMATIK 5" where Turkish wants "MATEMATİK 5". translate() runs before
-- lower() because lower('İ') yields i + U+0307 (combining dot) rather than a
-- plain i, which would split the two spellings apart again.
--
-- Scope is `deleted_at IS NULL`: a soft-deleted project (migration 029)
-- releases its title, and restoreProjectSoft re-checks on the way back.
--
-- HEALING
-- Within each colliding group the oldest row keeps its title and the rest
-- get " (2)", " (3)" … so nothing is deleted and nothing is silently merged
-- — the team sees the renamed rows in the UI and can retitle them properly.
-- Each rename lands in stage_history so the change is visible on the
-- project's own timeline rather than appearing out of nowhere. The outer
-- loop re-checks because a generated name can itself collide with an
-- existing project (a real "Test (2)" already in the catalog); names only
-- ever grow, so it terminates, and the pass guard is a backstop against a
-- case nobody predicted.

-- Dropped first so the renames below can never transiently violate an
-- older, differently-keyed version of this index (063's, on a DB that got
-- that far). The runner wraps the whole file in one transaction, so if
-- anything downstream fails we roll back to the index we started with.
DROP INDEX IF EXISTS idx_projects_title_unique;

DO $$
DECLARE
  pass    INT := 0;
  renamed INT;
  r       RECORD;
BEGIN
  LOOP
    pass := pass + 1;
    IF pass > 20 THEN
      RAISE EXCEPTION
        'Project title de-duplication did not settle after 20 passes — aborting rather than looping. Inspect projects.title by hand.';
    END IF;

    renamed := 0;

    FOR r IN
      WITH ranked AS (
        SELECT id, title, stage,
               row_number() OVER (
                 PARTITION BY lower(translate(regexp_replace(btrim(title), '\s+', ' ', 'g'), 'IıİI', 'iiii'))
                 ORDER BY created_at, id
               ) AS rn
          FROM projects
         WHERE deleted_at IS NULL
      )
      SELECT id, title, stage, rn FROM ranked WHERE rn > 1
    LOOP
      UPDATE projects
         SET title = r.title || ' (' || r.rn || ')',
             updated_at = NOW()
       WHERE id = r.id;

      -- done_by stays NULL: no user performed this, and the timeline
      -- renders "—" for a null actor rather than blaming whoever deployed.
      INSERT INTO stage_history (project_id, from_stage, to_stage, action, event, note)
      VALUES (
        r.id, r.stage, r.stage, 'system', 'project_edit',
        'Başlık → ' || r.title || ' (' || r.rn || ')'
        || ' · aynı adı taşıyan başka bir proje olduğu için otomatik yeniden adlandırıldı'
      );

      RAISE NOTICE '[065] renamed duplicate project %: "%" -> "% (%)"', r.id, r.title, r.title, r.rn;
      renamed := renamed + 1;
    END LOOP;

    EXIT WHEN renamed = 0;
  END LOOP;
END $$;

CREATE UNIQUE INDEX idx_projects_title_unique
    ON projects (lower(translate(regexp_replace(btrim(title), '\s+', ' ', 'g'), 'IıİI', 'iiii')))
 WHERE deleted_at IS NULL;
