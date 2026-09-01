/**
 * Tiny SQL migration runner.
 *
 * Design goals (deliberately constrained):
 *  • Zero external deps — only `pg`, the std lib, and the SQL files under
 *    `db/migrations/`.
 *  • Discoverable: filenames are `NNN__name.sql` and applied in order.
 *  • Idempotent boot: every migration is wrapped in `BEGIN/COMMIT`; the
 *    applied set is recorded in a `_migrations` table inside the same
 *    transaction, so a partially-applied file can never be recorded as
 *    successful.
 *  • Integrity guard (added 2026-09-01): every applied migration's file
 *    content is hashed at apply time and that hash is re-checked at boot
 *    against the file on disk. A mismatch refuses to start. Catches
 *    someone editing an already-applied migration after the fact, and
 *    catches a Docker volume reused across two different checkout SHAs
 *    where the same migration id was executed with different SQL.
 *  • Manual override: `node src/services/migrate.js status` shows applied
 *    vs. pending; `up` applies whatever's missing; `--down N` rolls back
 *    the last N migrations (added later — out of scope for this pass).
 *
 * Usage:
 *   node src/services/migrate.js up          # apply pending
 *   node src/services/migrate.js status      # show progress
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPool, closePool, withTx } from '../db/pool.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations')

const MIGRATION_FILE = /^(\d{3})__(.+)\.sql$/

async function ensureMigrationsTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum    TEXT
    )
  `)
}

async function listMigrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR)
  const files = entries
    .filter((name) => MIGRATION_FILE.test(name))
    .map((name) => {
      const [, id, label] = name.match(MIGRATION_FILE)
      return { id, label, file: name, path: path.join(MIGRATIONS_DIR, name) }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  // `id` is the PRIMARY KEY in `_migrations` — two files sharing an id would
  // make the second one look "already applied" and silently never run.
  const seen = new Map()
  for (const m of files) {
    if (seen.has(m.id)) {
      throw new Error(`Duplicate migration id ${m.id}: ${seen.get(m.id)} and ${m.file}`)
    }
    seen.set(m.id, m.file)
  }
  return files
}

async function appliedIds() {
  const { rows } = await getPool().query('SELECT id FROM _migrations ORDER BY id')
  return new Set(rows.map((r) => r.id))
}

async function appliedChecksums() {
  const { rows } = await getPool().query(
    'SELECT id, checksum FROM _migrations ORDER BY id',
  )
  return rows
}

/**
 * Boot-time integrity guard (decision 2026-09-01, Path A).
 *
 * Compares each applied migration's recorded checksum against the file on
 * disk and refuses to start on a mismatch. Catches:
 *  • a migration file edited locally after it was applied (someone
 *    "fixing" history after the fact)
 *  • a Docker volume reused across two different checkout SHAs where
 *    one container ran migration N with one SQL body and a sibling ran
 *    the same migration id with a different one
 *
 * Behaviour choices:
 *  • File missing → warn and continue. Deleting an applied migration's
 *    file is a normal refactor (e.g. consolidated into an earlier one)
 *    and shouldn't block boot.
 *  • Recorded checksum NULL → log info and skip. Back-compat for any
 *    legacy row that predates the checksum recording.
 *
 * Throws with a clear, debuggable message that names the offending id;
 * the upstream caller lets the exception bubble so the boot fails fast.
 *
 * Exported (named with a leading underscore) so `migrate.test.js` can
 * exercise the four branches without spinning up a real `_migrations`
 * table or running `up()`. Production callers reach it only through `up()`.
 */
export async function _assertAppliedChecksums(appliedRows) {
  const files = await listMigrationFiles()
  const fileById = new Map(files.map((f) => [f.id, f]))
  for (const row of appliedRows) {
    const file = fileById.get(row.id)
    if (!file) {
      // eslint-disable-next-line no-console
      console.warn(
        `[migrate] ${row.id}: applied migration's file is no longer in db/migrations/, skipping checksum check`,
      )
      continue
    }
    const sql = await fs.readFile(file.path, 'utf8')
    const current = hashSql(sql)
    if (row.checksum === null || row.checksum === undefined) {
      // eslint-disable-next-line no-console
      console.log(`[migrate] ${row.id}: no recorded checksum, skipping check (legacy row)`)
      continue
    }
    if (current !== row.checksum) {
      throw new Error(
        `[migrate] checksum mismatch for ${row.id}: file has been modified since it was applied. Refusing to start.`,
      )
    }
  }
}

export async function status() {
  await ensureMigrationsTable()
  const files = await listMigrationFiles()
  const applied = await appliedIds()
  return files.map((m) => ({
    id: m.id,
    label: m.label,
    file: m.file,
    applied: applied.has(m.id),
  }))
}

// Session-level advisory lock guarding the whole up() run. Blue/green means
// two containers can now boot with MIGRATE_ON_BOOT at nearly the same time;
// without this, both could see the same file as pending and race applying
// it. Arbitrary two-int key, namespaced away from the notification sweep's
// lock key in notification-maintenance.js.
const MIGRATION_LOCK_KEY = [872_190, 1]

export async function up() {
  const lockClient = await getPool().connect()
  try {
    // Blocking on purpose — this only runs at boot, and waiting a few
    // seconds for the other container to finish its own migration run is
    // preferable to erroring out.
    await lockClient.query('SELECT pg_advisory_lock($1, $2)', MIGRATION_LOCK_KEY)

    await ensureMigrationsTable()
    const files = await listMigrationFiles()
    const checksumRows = await appliedChecksums()
    // Boot-time integrity guard: refuse to start if any applied migration's
    // file has been modified since it was recorded. See _assertAppliedChecksums
    // for the rationale.
    await _assertAppliedChecksums(checksumRows)
    const applied = new Set(checksumRows.map((r) => r.id))
    const pending = files.filter((m) => !applied.has(m.id))
    if (pending.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[migrate] nothing to do — schema is up to date')
      return { applied: [], skipped: files.length }
    }
    const results = []
    for (const m of pending) {
      const sql = await fs.readFile(m.path, 'utf8')
      await withTx(async (client) => {
        await client.query(sql)
        await client.query(
          'INSERT INTO _migrations (id, checksum) VALUES ($1, $2)',
          [m.id, hashSql(sql)],
        )
      })
      results.push(m.id)
      // eslint-disable-next-line no-console
      console.log(`[migrate] applied ${m.id} (${m.label})`)
    }
    return { applied: results, skipped: applied.size }
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1, $2)', MIGRATION_LOCK_KEY)
    lockClient.release()
  }
}

export async function down() {
  // Symmetric rollback is intentionally not implemented in this pass —
  // re-running `up` is idempotent at the SQL level and we use forward-only
  // migrations. Hook for a future pass if a destructive rollback path is
  // ever needed (a `_migrations_down` table or paired -down.sql files).
  throw new Error('down() not implemented — run `up` again (idempotent) instead')
}

/**
 * Tiny deterministic content hash for a SQL file's body. Exported for the
 * unit test in migrate.test.js.
 *
 * The hash is recorded next to each applied migration in `_migrations.checksum`
 * and is verified at every boot by `assertAppliedChecksums` (decision 2026-09-01,
 * Path A). That makes a post-apply edit to the file visible: the next boot
 * will refuse to start instead of silently running with the modified SQL.
 *
 * The algorithm is intentionally trivial — a tiny non-cryptographic hash
 * (Java-style `h * 31 + charCode`). It's not for tamper resistance; it's
 * for "did the bytes on disk change?". Anything stronger (SHA-256, etc.)
 * would mean pulling in a dependency just to defend a column we never
 * expected anyone to actually look at. The values are stable across runs
 * and platforms.
 *
 * Returned as a hex string so the DB column can stay `TEXT`.
 */
export function hashSql(sql) {
  let h = 0
  for (let i = 0; i < sql.length; i++) {
    h = (h * 31 + sql.charCodeAt(i)) | 0
  }
  return h.toString(16)
}

// CLI entry — only run when this file is the script entry point. When
// imported from index.js (boot path), the IIFE must NOT execute: it
// would call closePool() and starve every later query in the process.
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2] ?? 'up'
  ;(async () => {
    try {
      if (cmd === 'status') {
        const rows = await status()
        for (const r of rows) {
          const tag = r.applied ? '✓' : '·'
          // eslint-disable-next-line no-console
          console.log(`${tag} ${r.id}  ${r.file}`)
        }
      } else if (cmd === 'up') {
        await up()
      } else if (cmd === 'down') {
        await down()
      } else {
        // eslint-disable-next-line no-console
        console.error(`Unknown command: ${cmd} (use 'up', 'down', or 'status')`)
        process.exitCode = 2
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[migrate] failed:', err.message)
      process.exitCode = 1
    } finally {
      await closePool()
    }
  })()
}
