/**
 * Unit tests for the migration runner's checksum machinery.
 *
 * Two layers are tested here:
 *
 *   1. `hashSql` itself — determinism and sensitivity. The boot-time guard
 *      depends on `hashSql` flagging any byte-level change to a migration
 *      file, so the function must (a) be deterministic and (b) treat two
 *      different byte sequences as different. The 'SELECT1;' example is
 *      pinned by the user's task spec; the whitespace-edits variant
 *      stresses the realistic case the guard exists for — someone quietly
 *      trailing-spaces a file in their editor after applying it.
 *
 *   2. `assertAppliedChecksums` — the boot-time integrity guard. Reads
 *      applied rows from its argument (the SELECT happens in `up()`; this
 *      helper is data-in, throw-or-return) and walks the live
 *      `db/migrations/` directory to recompute hashes. Each branch
 *      (match, mismatch, file-missing, legacy NULL) gets a focused test.
 *
 * No real DB connection is required: the helper takes pre-loaded rows, and
 * `hashSql` is pure.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

import { hashSql, _assertAppliedChecksums } from './migrate.js'

/**
 * The boot-time guard walks `db/migrations/` on disk via `listMigrationFiles`,
 * which imports `migrate.js`'s module-level `MIGRATIONS_DIR`. The first
 * applied migration in this repo (`001__users.sql`) is the most stable thing
 * to assert against — it has been present since day one and any test failure
 * here would be a real-world regression. We read it once per test rather than
 * cache the hash, since the file content can change over the project's life.
 */
const KNOWN_APPLIED_ID = '001'
const KNOWN_FILE_BASENAME = '001__users.sql'

test('hashSql of "SELECT1;" returns a stable value', () => {
  // Pinned snapshot — if the algorithm ever changes, the recorded DB
  // checksums would silently invalidate every applied migration. Bumping
  // this literal is the only "right" way to evolve the hash; do not edit
  // casually.
  assert.equal(typeof hashSql('SELECT1;'), 'string')
  assert.equal(hashSql('SELECT1;'), '75abe026')
})

test('hashSql is deterministic — same SQL → same hash', () => {
  const sql = 'CREATE TABLE foo (id INT PRIMARY KEY);'
  const first = hashSql(sql)
  const second = hashSql(sql)
  const third = hashSql(sql)
  assert.equal(first, second)
  assert.equal(second, third)
})

test('hashSql distinguishes different SQL', () => {
  const a = hashSql('SELECT 1;')
  const b = hashSql('SELECT 2;')
  assert.notEqual(a, b, 'different SQL must hash to different values')
})

test('hashSql flags trailing-whitespace edits (the realistic tamper case)', () => {
  // The whole point of the boot-time guard: a one-character visible
  // change — a stray trailing space, an editor's auto-format — must
  // produce a different hash, otherwise the guard is theatre.
  const before = hashSql('SELECT 1;\n')
  const after = hashSql('SELECT 1;\n ')
  assert.notEqual(before, after)
})

test('hashSql ignores zero-length input unambiguously', () => {
  // A guard that hashes '' to the same value as some real file would be
  // useless. Asserting this guards against future "optimisations" that
  // try to short-circuit empty inputs.
  const empty = hashSql('')
  assert.notEqual(empty, hashSql(';'))
})

// ---------------------------------------------------------------------------
// Boot-time integrity guard — _assertAppliedChecksums
// ---------------------------------------------------------------------------

test('_assertAppliedChecksums refuses to start when the recorded checksum is stale', async () => {
  // Bogus recorded hash → the function reads the real file from disk,
  // recomputes hashSql, sees the disagreement, and throws. We don't have
  // to actually tamper with anyone; the recorded-hash argument is the
  // ground truth that would have been written when the migration ran.
  const rows = [{ id: KNOWN_APPLIED_ID, checksum: 'deadbeef-not-the-real-hash' }]
  await assert.rejects(
    _assertAppliedChecksums(rows),
    (err) => {
      assert.match(err.message, /checksum mismatch for 001/)
      assert.match(err.message, /Refusing to start/)
      return true
    },
  )
})

test('_assertAppliedChecksums passes when the recorded checksum matches the live file', async () => {
  // Read the file ourselves, compute the hash, hand it back as if the DB
  // had stored it. The guard then re-derives the same value and accepts.
  const filePath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    '..',
    'db',
    'migrations',
    KNOWN_FILE_BASENAME,
  )
  const liveSql = await fs.readFile(filePath, 'utf8')
  const liveHash = hashSql(liveSql)
  await _assertAppliedChecksums([{ id: KNOWN_APPLIED_ID, checksum: liveHash }])
})

test('_assertAppliedChecksums warns but does NOT throw when the applied file is missing', async () => {
  // A migration that was applied long ago and later deleted (e.g. its
  // changes got absorbed into an earlier file) must not block boot.
  // We pick a high id that the regex would never accept as a filename —
  // '999__never_existed.sql' doesn't actually exist on disk — to make
  // sure the "missing file" branch is the one exercised.
  const rows = [{ id: '999', checksum: 'anything-non-null' }]
  await _assertAppliedChecksums(rows)
})

test('_assertAppliedChecksums tolerates a NULL recorded checksum (legacy row)', async () => {
  // Back-compat: a row in `_migrations` from before we started recording
  // checksums will have `checksum = NULL`. The guard must skip such rows
  // rather than reject every legacy boot.
  const rows = [{ id: KNOWN_APPLIED_ID, checksum: null }]
  await _assertAppliedChecksums(rows)
})
