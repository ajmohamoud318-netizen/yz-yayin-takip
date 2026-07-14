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
  return entries
    .filter((name) => MIGRATION_FILE.test(name))
    .map((name) => {
      const [, id, label] = name.match(MIGRATION_FILE)
      return { id, label, file: name, path: path.join(MIGRATIONS_DIR, name) }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

async function appliedIds() {
  const { rows } = await getPool().query('SELECT id FROM _migrations ORDER BY id')
  return new Set(rows.map((r) => r.id))
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

export async function up() {
  await ensureMigrationsTable()
  const files = await listMigrationFiles()
  const applied = await appliedIds()
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
}

export async function down() {
  // Symmetric rollback is intentionally not implemented in this pass —
  // re-running `up` is idempotent at the SQL level and we use forward-only
  // migrations. Hook for a future pass if a destructive rollback path is
  // ever needed (a `_migrations_down` table or paired -down.sql files).
  throw new Error('down() not implemented — run `up` again (idempotent) instead')
}

function hashSql(sql) {
  // Tiny content checksum so a tweaked-applied-file is visible in the DB.
  // We don't validate against it on subsequent runs (intentional — keeps
  // local edits cheap) but it's recorded for forensics.
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
