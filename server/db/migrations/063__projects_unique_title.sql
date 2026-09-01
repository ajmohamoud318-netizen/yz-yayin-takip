-- 063 — one live project per title
--
-- A project's only human-readable handle is its title: ids are `p-<nanoid>`
-- and never rendered, so two live projects called "Işık Serisi" are
-- indistinguishable in every list, picker, order form and notification the
-- team sees. Reprints are already modelled on the *same* row (pass_number /
-- pass_kind, migration 002), so a second row carrying an existing title is a
-- double entry rather than a second edition.
--
-- Scope is `deleted_at IS NULL`: soft-deleting a project (migration 029)
-- releases its title for reuse, and restoreProject translates the 23505 it
-- may hit on the way back into a 409 the leader can act on.
--
-- The app-level guard (domain/project-title.js) normalises in the Turkish
-- locale — tr-TR maps I→ı and İ→i, which SQL `lower()` cannot reproduce.
-- This index is deliberately the *narrower* of the two: it exists to catch
-- the concurrent-insert race the JS check cannot see, and every write path
-- turns its violation into the same 409 as the check itself.

-- Refuse to install the invariant over data that already breaks it, with a
-- message that names the offenders — otherwise the operator gets a bare
-- "could not create unique index" and no idea which rows to fix.
DO $$
DECLARE
  clashes TEXT;
BEGIN
  SELECT string_agg(sample, ', ')
    INTO clashes
    FROM (
      SELECT min(title) || ' (x' || count(*) || ')' AS sample
        FROM projects
       WHERE deleted_at IS NULL
       GROUP BY lower(regexp_replace(btrim(title), '\s+', ' ', 'g'))
      HAVING count(*) > 1
    ) d;
  IF clashes IS NOT NULL THEN
    RAISE EXCEPTION
      'Duplicate project titles already exist among live rows: %. Rename or soft-delete the extras, then re-run this migration.',
      clashes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_title_unique
    ON projects (lower(regexp_replace(btrim(title), '\s+', ' ', 'g')))
 WHERE deleted_at IS NULL;
