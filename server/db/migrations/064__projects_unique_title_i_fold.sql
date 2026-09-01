-- 064 — fold Turkish dotted/dotless i into the unique-title key
--
-- 063 keyed the index on lower(<collapsed title>). That matches how a
-- Turkish keyboard types, and misses how everyone else does.
--
-- Turkish has two i's: dotted i/İ and dotless ı/I. Only a Turkish layout
-- produces the dotted capital, so the caps form of "Matematik 5" arrives as
-- "MATEMATIK 5" from a phone set to English or from an Excel paste — which
-- lowercases to "matematık 5" and slips past 063 as a different book. With
-- this team on phones that is the likely way a double entry gets in.
--
-- So all four letters collapse onto 'i' here, matching normaliseProjectTitle
-- in domain/project-title.js. The accepted cost: two titles differing ONLY
-- by a dotted vs dotless i can no longer both exist.
--
-- translate() runs before lower() because it is the dotted capital İ that
-- lower() would otherwise turn into i + U+0307 (combining dot above) rather
-- than a plain i, leaving the two spellings on different keys again.
--
-- The index name is unchanged, so isTitleConflictError keeps matching on it.

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
       GROUP BY lower(translate(regexp_replace(btrim(title), '\s+', ' ', 'g'), 'IıİI', 'iiii'))
      HAVING count(*) > 1
    ) d;
  IF clashes IS NOT NULL THEN
    RAISE EXCEPTION
      'These live titles differ only by dotted/dotless i and cannot both survive the folded index: %. Rename or soft-delete one of each pair, then re-run this migration.',
      clashes;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_projects_title_unique;

CREATE UNIQUE INDEX idx_projects_title_unique
    ON projects (lower(translate(regexp_replace(btrim(title), '\s+', ' ', 'g'), 'IıİI', 'iiii')))
 WHERE deleted_at IS NULL;
