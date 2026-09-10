/**
 * The detection query in scripts/stuck-baskida.mjs, run against a real schema.
 *
 * A repair script's whole value is that it finds exactly the damaged rows: too
 * narrow and the projects stay silently stuck, too broad and it pings the
 * matbaa about work that was announced correctly. Neither mistake is visible
 * by reading the SQL — the query joins three tables and turns on the ABSENCE of
 * a row — so it is exercised here against fixtures for every case it has to
 * tell apart.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { FIND_SQL } from './stuck-baskida.mjs'

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../db/migrations',
)

let PGlite = null
try {
  ({ PGlite } = await import('@electric-sql/pglite'))
} catch {
  // eslint-disable-next-line no-console
  console.log('[stuck-baskida.test] pglite not installed — skipping')
}

/**
 * One project in a named situation, plus the rows that put it there.
 *
 * `announced` writes the notification the printers should have received;
 * `viaOrder` writes the `order_final` stage_history row that marks the flip as
 * sipariş-driven rather than a main-pipeline advance.
 */
async function project(db, id, { stage, viaOrder, announced }) {
  await db.exec(`
    INSERT INTO projects (id, title, type, stage) VALUES ('${id}', 'Kitap ${id}', 'TR', '${stage}');
  `)
  if (viaOrder) {
    await db.exec(`
      INSERT INTO stage_history (project_id, from_stage, to_stage, action, event, note)
      VALUES ('${id}', 'baski_onayi_bekleniyor', 'baskida', 'system', 'order_final',
              'Baskı onaylandı, baskıya alındı');
    `)
  }
  if (announced) {
    await db.exec(`
      INSERT INTO notifications (user_id, type, title, body, tone, project_id, link)
      VALUES ('printer1', 'production_ready', 'Kitap ${id}', 'Proje baskıda alındı',
              'green', '${id}', '/baski-listesi');
    `)
  }
}

async function seeded() {
  const db = new PGlite()
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => /^\d{3}__.+\.sql$/.test(f)).sort()
  for (const f of files) {
    await db.exec(`BEGIN; ${await fs.readFile(path.join(MIGRATIONS_DIR, f), 'utf8')} ; COMMIT;`)
  }
  await db.exec(`
    INSERT INTO users (id, name, email, role)
    VALUES ('printer1', 'Oktay', 'o@e.com', 'printer');
  `)
  return db
}

test('finds a sipariş-driven baskıda project nobody announced', { skip: !PGlite }, async () => {
  const db = await seeded()
  await project(db, 'stuck', { stage: 'baskida', viaOrder: true, announced: false })
  const { rows } = await db.query(FIND_SQL)
  assert.deepEqual(rows.map((r) => r.id), ['stuck'])
  await db.close()
})

test('leaves alone every project that is not actually stuck', { skip: !PGlite }, async () => {
  const db = await seeded()

  // Announced correctly — the printers were told, nothing owed.
  await project(db, 'announced', { stage: 'baskida', viaOrder: true, announced: true })
  // Main-pipeline advance: no order_final row, so not this bug.
  await project(db, 'mainline', { stage: 'baskida', viaOrder: false, announced: false })
  // Moved on. Whatever happened, the printers evidently picked it up.
  await project(db, 'moved-on', { stage: 'satista', viaOrder: true, announced: false })

  const { rows } = await db.query(FIND_SQL)
  assert.deepEqual(rows.map((r) => r.id), [], `false positives: ${rows.map((r) => r.id)}`)
  await db.close()
})

test('a soft-deleted project is never resurrected into the queue', { skip: !PGlite }, async () => {
  const db = await seeded()
  await project(db, 'deleted', { stage: 'baskida', viaOrder: true, announced: false })
  await db.exec("UPDATE projects SET deleted_at = NOW() WHERE id = 'deleted'")
  const { rows } = await db.query(FIND_SQL)
  assert.deepEqual(rows.map((r) => r.id), [])
  await db.close()
})

test('picks the stuck one out of a mixed board, oldest first', { skip: !PGlite }, async () => {
  const db = await seeded()
  await project(db, 'announced', { stage: 'baskida', viaOrder: true, announced: true })
  await project(db, 'stuck-new', { stage: 'baskida', viaOrder: true, announced: false })
  await project(db, 'moved-on', { stage: 'gumruk', viaOrder: true, announced: false })
  await project(db, 'stuck-old', { stage: 'baskida', viaOrder: true, announced: false })
  // Age the older one so the ordering is deterministic rather than insertion-timed.
  await db.exec(`
    UPDATE stage_history SET created_at = NOW() - INTERVAL '30 days'
     WHERE project_id = 'stuck-old'
  `)

  const { rows } = await db.query(FIND_SQL)
  assert.deepEqual(
    rows.map((r) => r.id), ['stuck-old', 'stuck-new'],
    'oldest-first ordering puts the longest-stuck project at the top of the report',
  )
  await db.close()
})

test('re-running after a repair finds nothing — the script is resumable', { skip: !PGlite }, async () => {
  const db = await seeded()
  await project(db, 'stuck', { stage: 'baskida', viaOrder: true, announced: false })
  assert.equal((await db.query(FIND_SQL)).rows.length, 1)

  // What --apply writes. The query keys on this row's absence, which is what
  // makes a half-finished run safe to restart: repaired projects drop out.
  await db.exec(`
    INSERT INTO notifications (user_id, type, title, body, tone, project_id, link)
    VALUES ('printer1', 'production_ready', 'Kitap stuck', 'Proje baskıda alındı',
            'green', 'stuck', '/baski-listesi');
  `)
  assert.equal((await db.query(FIND_SQL)).rows.length, 0, 'a repaired project must not be found again')
  await db.close()
})
