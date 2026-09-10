/**
 * Migration tests — run the REAL migration files against a real Postgres.
 *
 * Why this exists
 * ---------------
 * Every other test in this repo drives a fake pg client: they assert which SQL
 * we *meant* to send, never that Postgres accepts it. That is fine for service
 * logic and useless for DDL. Migration 080 drops a primary key and replaces it
 * with two PARTIAL unique indexes, and the repository then asks Postgres to
 * infer those partial indexes as `ON CONFLICT` arbiters — a thing Postgres is
 * strict about and a fake client cannot model at all. Reading the generated SQL
 * proves nothing; only executing it does.
 *
 * The database here is PGlite: actual PostgreSQL compiled to WASM, running
 * in-process. No server, no service, no container, nothing installed — so this
 * runs anywhere `npm test` does, including CI and a laptop with no Postgres.
 * It is a devDependency and never reaches the image (server/Dockerfile installs
 * with --omit=dev).
 *
 * What it guards
 * --------------
 * That the whole migration chain applies from empty, that the newest migration
 * is idempotent (the runner re-reads files on every boot, so a non-idempotent
 * one bricks startup), and that the constraints enforce what their comments
 * claim. The last one matters most: a unique index that silently fails to
 * constrain looks exactly like one that works until data is corrupt.
 *
 * Adding a migration? Add its assertions here. The generic chain test below
 * covers it for free, but "it applied" is a much weaker claim than "it does
 * what it says".
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

// PGlite is a devDependency. An install that omitted dev deps (the production
// image) must skip these rather than fail the file's import — the same shape
// the runner itself uses for optional work.
let PGlite = null
try {
  ({ PGlite } = await import('@electric-sql/pglite'))
} catch {
  // eslint-disable-next-line no-console
  console.log('[migrations.test] @electric-sql/pglite not installed — skipping')
}

async function migrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR)
  return entries.filter((f) => /^\d{3}__.+\.sql$/.test(f)).sort()
}

/**
 * A fresh database with every migration applied, in order.
 *
 * Each file is sent as ONE `exec` inside BEGIN/COMMIT, which is exactly what
 * services/migrate.js does (`client.query(sql)` on the whole file). That
 * fidelity is the point: a file that only works when split statement-by-
 * statement would pass a laxer harness and fail at boot.
 */
async function freshDb({ upToExclusive = null } = {}) {
  const db = new PGlite()
  for (const f of await migrationFiles()) {
    if (upToExclusive && f >= upToExclusive) break
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, f), 'utf8')
    try {
      await db.exec(`BEGIN; ${sql} ; COMMIT;`)
    } catch (err) {
      await db.exec('ROLLBACK;').catch(() => {})
      throw new Error(`migration ${f} failed to apply: ${err.message}`)
    }
  }
  return db
}

test('every migration applies from an empty database', { skip: !PGlite }, async () => {
  const db = await freshDb()
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public'`,
  )
  assert.ok(rows[0].n > 10, `expected a populated schema, got ${rows[0].n} tables`)
  await db.close()
})

test('the newest migration is idempotent — a re-run is a clean no-op', { skip: !PGlite }, async () => {
  // The runner records applied ids and skips them, so a second run should never
  // happen in practice. It happens anyway: a volume restored from a backup taken
  // before the _migrations row committed, a manual `migrate up` against a DB
  // someone already patched by hand. Re-applying must not throw, or the app
  // cannot boot.
  const files = await migrationFiles()
  const newest = files[files.length - 1]
  const db = await freshDb()
  const sql = await fs.readFile(path.join(MIGRATIONS_DIR, newest), 'utf8')
  await db.exec(`BEGIN; ${sql} ; COMMIT;`)
  await db.close()
})

/* ==========================================================================
 *  080 — parca_state gains the order dimension
 * ======================================================================== */

test('080: parca_state carries a nullable order_id and no primary key', { skip: !PGlite }, async () => {
  const db = await freshDb()

  const col = await db.query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'parca_state' AND column_name = 'order_id'`,
  )
  assert.equal(col.rows.length, 1, 'parca_state.order_id is missing')
  assert.equal(col.rows[0].is_nullable, 'YES', 'order_id must be nullable — NULL means a project round')

  // A primary key cannot contain NULLs, which is the whole reason it was
  // replaced. If one is still here, the widening never happened.
  const pk = await db.query(
    `SELECT conname FROM pg_constraint
      WHERE conrelid = 'parca_state'::regclass AND contype = 'p'`,
  )
  assert.equal(pk.rows.length, 0, `primary key still present: ${pk.rows.map((r) => r.conname)}`)

  await db.close()
})

test('080: both replacement indexes exist AND are partial', { skip: !PGlite }, async () => {
  const db = await freshDb()
  const { rows } = await db.query(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'parca_state'`,
  )
  const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]))

  for (const name of ['ux_parca_state_project', 'ux_parca_state_order']) {
    assert.ok(byName.has(name), `${name} missing`)
    // The partial predicate is not decoration. A plain UNIQUE across three
    // columns, one of them nullable, does NOT constrain the rows where it is
    // NULL — two NULLs are never equal in SQL — so every project row would be
    // free to duplicate. `WHERE` is what makes each index cover exactly one
    // pipeline.
    assert.match(
      byName.get(name), /WHERE/,
      `${name} is not partial — one pipeline's rows would be unconstrained`,
    )
  }
  await db.close()
})

test('080: order_requests gains its own per-parça ledgers', { skip: !PGlite }, async () => {
  const db = await freshDb()
  const { rows } = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'order_requests'
        AND column_name IN ('ozalit_parca_approvals', 'ozalit_parca_rejections',
                            'baski_parca_preparers', 'baski_parca_approvals')`,
  )
  assert.equal(rows.length, 4, `got ${rows.map((r) => r.column_name).join(', ')}`)
  await db.close()
})

/**
 * The constraints, exercised rather than inspected.
 *
 * This is the test that would have caught a non-partial index: it inserts the
 * exact rows the feature depends on being allowed, and the exact rows it
 * depends on being refused.
 */
test('080: a sipariş parça and a project parça of the same name coexist', { skip: !PGlite }, async () => {
  const db = await freshDb()
  await db.exec(`
    INSERT INTO users (id, name, email, role) VALUES ('u1','Ayşenur','a@e.com','team_leader');
    INSERT INTO projects (id, title, type, stage) VALUES ('p1','Kitap','TR','ozalit_teslim');
    INSERT INTO order_requests (id, project_id, requested_by, status)
      VALUES ('o1','p1','u1','matbaa_ozalit_yapiyor'), ('o2','p1','u1','matbaa_ozalit_yapiyor');
  `)
  const insert = (order, parca) => db.exec(
    `INSERT INTO parca_state (project_id, order_id, parca, gate)
     VALUES ('p1', ${order === null ? 'NULL' : `'${order}'`}, '${parca}', 'ozalit')`,
  )

  await insert(null, 'KUTU')
  await insert('o1', 'KUTU')   // the same parça name, on an order — must be allowed
  await insert('o2', 'KUTU')   // two concurrent orders on one title — also allowed

  await assert.rejects(
    () => insert(null, 'KUTU'),
    'a duplicate PROJECT row was accepted — ux_parca_state_project is not constraining',
  )
  await assert.rejects(
    () => insert('o1', 'KUTU'),
    'a duplicate ORDER row was accepted — ux_parca_state_order is not constraining',
  )
  await db.close()
})

test('080: deleting an order cascades its parçalar and spares the project\'s', { skip: !PGlite }, async () => {
  const db = await freshDb()
  await db.exec(`
    INSERT INTO users (id, name, email, role) VALUES ('u1','Ayşenur','a@e.com','team_leader');
    INSERT INTO projects (id, title, type, stage) VALUES ('p1','Kitap','TR','ozalit_teslim');
    INSERT INTO order_requests (id, project_id, requested_by, status)
      VALUES ('o1','p1','u1','matbaa_ozalit_yapiyor');
    INSERT INTO parca_state (project_id, order_id, parca, gate)
      VALUES ('p1', NULL, 'KUTU', 'ozalit'), ('p1', 'o1', 'KUTU', 'ozalit');
    DELETE FROM order_requests WHERE id = 'o1';
  `)
  const orphans = await db.query("SELECT count(*)::int AS n FROM parca_state WHERE order_id = 'o1'")
  assert.equal(orphans.rows[0].n, 0, 'the order\'s parçalar did not cascade')
  const kept = await db.query('SELECT count(*)::int AS n FROM parca_state WHERE order_id IS NULL')
  assert.equal(kept.rows[0].n, 1, 'the project\'s own parça was collateral damage')
  await db.close()
})

/* ==========================================================================
 *  081 — the sipariş print run gains its own teslim
 * ======================================================================== */

const M081 = '081__order_handovers.sql'

async function applyMigration(db, file) {
  const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
  await db.exec(`BEGIN; ${sql} ; COMMIT;`)
}

test('081: handovers carries a nullable order_id that cascades', { skip: !PGlite }, async () => {
  const db = await freshDb()
  const col = await db.query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'handovers' AND column_name = 'order_id'`,
  )
  assert.equal(col.rows.length, 1, 'handovers.order_id is missing')
  assert.equal(
    col.rows[0].is_nullable, 'YES',
    'order_id must be nullable — NULL is the project\'s own teslim, i.e. every row that already existed',
  )
  await db.close()
})

test('081: a project teslim and a reprint teslim can both be pending', { skip: !PGlite }, async () => {
  // The reason the old single guard had to be split. These are two different
  // physical deliveries of two different sets of copies; either blocking the
  // other strands a real one.
  const db = await freshDb()
  await db.exec(`
    INSERT INTO users (id, name, email, role) VALUES ('u1','Oktay','o@e.com','printer');
    INSERT INTO projects (id, title, type, stage) VALUES ('p1','Kitap','TR','baskida');
    INSERT INTO order_requests (id, project_id, requested_by, status)
      VALUES ('o1','p1','u1','baskida'), ('o2','p1','u1','baskida');
  `)
  const insert = (id, orderId) => db.query(
    `INSERT INTO handovers (id, project_id, order_id, status, from_stage)
     VALUES ($1,'p1',$2,'pending','baskida')`,
    [id, orderId],
  )
  await insert('h1', null)   // the project's own
  await insert('h2', 'o1')   // one reprint
  await insert('h3', 'o2')   // a second, concurrent reprint — also allowed

  await assert.rejects(
    () => insert('h4', null),
    'a second pending PROJECT teslim was accepted — uq_handovers_pending_per_project is not constraining',
  )
  await assert.rejects(
    () => insert('h5', 'o1'),
    'a second pending ORDER teslim was accepted — uq_handovers_pending_per_order is not constraining',
  )

  // Settling one frees the slot: a later run of the same order gets its own.
  await db.query("UPDATE handovers SET status = 'received' WHERE id = 'h2'")
  await insert('h6', 'o1')
  await db.close()
})

test('081: deleting an order cascades its teslim rows and spares the project\'s', { skip: !PGlite }, async () => {
  const db = await freshDb()
  await db.exec(`
    INSERT INTO users (id, name, email, role) VALUES ('u1','Oktay','o@e.com','printer');
    INSERT INTO projects (id, title, type, stage) VALUES ('p1','Kitap','TR','baskida');
    INSERT INTO order_requests (id, project_id, requested_by, status) VALUES ('o1','p1','u1','baskida');
    INSERT INTO handovers (id, project_id, order_id, status, from_stage)
      VALUES ('h1','p1',NULL,'pending','baskida'), ('h2','p1','o1','pending','baskida');
    DELETE FROM order_requests WHERE id = 'o1';
  `)
  const rows = await db.query('SELECT id FROM handovers ORDER BY id')
  assert.deepEqual(
    rows.rows.map((r) => r.id), ['h1'],
    "the order's teslim must cascade and the project's must survive",
  )
  await db.close()
})

test('081: the status CHECK accepts teslim_edildi and still refuses nonsense', { skip: !PGlite }, async () => {
  const db = await freshDb()
  await db.exec(`
    INSERT INTO users (id, name, email, role) VALUES ('u1','Oktay','o@e.com','printer');
    INSERT INTO projects (id, title, type, stage) VALUES ('p1','Kitap','TR','baskida');
    INSERT INTO order_requests (id, project_id, requested_by, status) VALUES ('o1','p1','u1','baskida');
  `)
  await db.query("UPDATE order_requests SET status = 'teslim_edildi' WHERE id = 'o1'")
  await assert.rejects(
    () => db.query("UPDATE order_requests SET status = 'onaylandi' WHERE id = 'o1'"),
    'the CHECK let a retired status name through — migration 066 renamed it away',
  )
  await db.close()
})

test('081: the backfill closes runs that finished before the teslim leg existed', { skip: !PGlite }, async () => {
  // The migration draws a cut-off. Every order already at `baskida` was
  // physically handed over off-system, because there was no system to hand it
  // over in — without this they would all appear in the matbaa's teslim queue
  // on the morning of the deploy, asking to re-deliver history.
  const db = await freshDb({ upToExclusive: M081 })
  await db.exec(`
    INSERT INTO users (id, name, email, role) VALUES ('u1','Oktay','o@e.com','printer');
    INSERT INTO projects (id, title, type, stage) VALUES ('p1','Kitap','TR','satista');
    INSERT INTO order_requests (id, project_id, requested_by, status)
      VALUES ('done','p1','u1','baskida'), ('mid','p1','u1','imza_bekleniyor');
  `)
  await applyMigration(db, M081)

  const after = await db.query('SELECT id, status FROM order_requests ORDER BY id')
  assert.deepEqual(
    Object.fromEntries(after.rows.map((r) => [r.id, r.status])),
    { done: 'teslim_edildi', mid: 'imza_bekleniyor' },
    'only finished runs are closed; anything mid-pipeline must be left alone',
  )

  // It says so on the timeline rather than changing state silently, and signs
  // the row to nobody — no person confirmed these.
  const hist = await db.query(
    "SELECT order_id, signed_by_id FROM order_history WHERE step = 'teslim_edildi'",
  )
  assert.deepEqual(hist.rows.map((r) => r.order_id), ['done'])
  assert.equal(hist.rows[0].signed_by_id, null, 'a backfill must not sign as a real user')

  // And invents no receipts: a handover row means somebody actually raised and
  // confirmed one.
  const ho = await db.query('SELECT count(*)::int AS n FROM handovers')
  assert.equal(ho.rows[0].n, 0)
  await db.close()
})
