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

/* ==========================================================================
 *  082 — Sticker is logged the way İç Sayfalar is
 * ======================================================================== */

const M082 = '082__sticker_designer_batches.sql'

test('082: a sticker batch counts stickers, a page batch still counts pages', { skip: !PGlite }, async () => {
  const db = await freshDb()
  await db.exec(`
    INSERT INTO users (id, name, email, role) VALUES ('d1','Ayşe','a@e.com','designer');
    INSERT INTO projects (id, title, type, stage) VALUES ('p1','Kitap','TR','tasarim');
    INSERT INTO subtasks (id, project_id, title, kind, total_pages, total_stickers) VALUES
      ('st','p1','Sticker','sticker-count',NULL,24),
      ('pg','p1','İç Sayfalar','pages',20,NULL);
    INSERT INTO subtask_designer_batches (subtask_id, designer_id, pages) VALUES
      ('st','d1',10), ('pg','d1',20);
  `)
  const { rows } = await db.query(
    'SELECT id, is_done, stickers_done, pages_done FROM subtasks ORDER BY id',
  )
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
  // Before 082 the trigger wrote every batch into pages_done, so a sticker row
  // read 0 stickers done — and closed against total_pages, which it has none of.
  assert.equal(byId.st.stickers_done, 10)
  assert.equal(byId.st.pages_done, 0, 'a sticker batch leaked into pages_done')
  assert.equal(byId.st.is_done, false)
  assert.equal(byId.pg.pages_done, 20)
  assert.equal(byId.pg.is_done, true)

  // The last sticker closes the row, the same way the last page does.
  await db.exec("INSERT INTO subtask_designer_batches (subtask_id, designer_id, pages) VALUES ('st','d1',14)")
  const after = await db.query("SELECT is_done, stickers_done FROM subtasks WHERE id = 'st'")
  assert.deepEqual(after.rows[0], { is_done: true, stickers_done: 24 })
  await db.close()
})

test('082: the backfill keeps ticked stickers done and refreshes stuck progress', { skip: !PGlite }, async () => {
  const db = await freshDb({ upToExclusive: M082 })
  await db.exec(`
    INSERT INTO users (id, name, email, role) VALUES
      ('d1','Ayşe','a@e.com','designer'), ('d2','Mehmet','m@e.com','designer');
    INSERT INTO projects (id, title, type, stage, assigned_to, progress) VALUES
      ('ticked','A','TR','tasarim','d1',50),
      ('partial','B','TR','tasarim','d1',0),
      ('open','C','TR','tasarim','d1',0),
      ('printing','D','TR','baskida','d1',100);
    INSERT INTO subtasks (id, project_id, title, kind, total_stickers, stickers_done, is_done, done_at, assigned_to) VALUES
      ('t-st','ticked','Sticker','sticker-count',24,0,true,'2026-09-01T10:00:00Z','d2'),
      ('t-k','ticked','Kapak','check',NULL,0,true,NULL,'d1'),
      ('t-y','ticked','Yazılım','check',NULL,0,false,NULL,'d1'),
      ('p-st','partial','Sticker','sticker-count',10,4,false,NULL,NULL),
      ('o-st','open','Sticker','sticker-count',24,0,false,NULL,'d1'),
      ('b-st','printing','Sticker','sticker-count',24,0,true,NULL,'d1');
  `)
  await applyMigration(db, M082)

  const batches = await db.query(
    'SELECT subtask_id, designer_id, pages FROM subtask_designer_batches ORDER BY subtask_id',
  )
  assert.deepEqual(batches.rows, [
    // Ticked stays ticked: 1..24, credited to the subtask's own designer.
    { subtask_id: 'b-st', designer_id: 'd1', pages: 24 },
    // A pre-checkbox counter keeps its count, credited to the project owner
    // because the subtask has none.
    { subtask_id: 'p-st', designer_id: 'd1', pages: 4 },
    { subtask_id: 't-st', designer_id: 'd2', pages: 24 },
  ], 'an untouched Sticker must get no batch — nobody did that work')

  const subs = await db.query(
    "SELECT id, is_done, stickers_done FROM subtasks WHERE kind = 'sticker-count' ORDER BY id",
  )
  assert.deepEqual(
    Object.fromEntries(subs.rows.map((r) => [r.id, [r.is_done, r.stickers_done]])),
    { 'b-st': [true, 24], 'o-st': [false, 0], 'p-st': [false, 4], 't-st': [true, 24] },
  )

  // The ticked Sticker used to count 0%, holding its project below the gate.
  // Kapak + Sticker, Yazılım excluded: 100. Partial: 4/10 of its one subtask.
  // A project in print is pinned at 100 by progressFor and is left alone.
  const projects = await db.query('SELECT id, progress FROM projects ORDER BY id')
  assert.deepEqual(
    Object.fromEntries(projects.rows.map((r) => [r.id, r.progress])),
    { open: 0, partial: 40, printing: 100, ticked: 100 },
  )

  // A re-run credits nobody twice.
  await applyMigration(db, M082)
  const again = await db.query('SELECT count(*)::int AS n FROM subtask_designer_batches')
  assert.equal(again.rows[0].n, 3)
  await db.close()
})

/* ==========================================================================
 *  083 — every sipariş gets a number within its book
 * ======================================================================== */

const M083 = '083__order_no.sql'

test('083: the backfill numbers each project\'s orders in the order they were raised', { skip: !PGlite }, async () => {
  const db = await freshDb({ upToExclusive: M083 })
  await db.exec(`
    INSERT INTO users (id, name, email, role) VALUES ('u1','Esra','e@e.com','satis');
    INSERT INTO projects (id, title, type, stage) VALUES ('pa','A','TR','satista'), ('pb','B','TR','satista');
    INSERT INTO order_requests (id, project_id, requested_by, status, created_at) VALUES
      ('a-new','pa','u1','atama_bekleniyor','2026-05-01'),
      ('a-old','pa','u1','teslim_edildi','2026-01-01'),
      ('b-only','pb','u1','baskida','2026-02-01'),
      ('a-mid','pa','u1','imza_bekleniyor','2026-03-01');
  `)
  await applyMigration(db, M083)

  const { rows } = await db.query('SELECT id, order_no FROM order_requests ORDER BY id')
  assert.deepEqual(
    Object.fromEntries(rows.map((r) => [r.id, r.order_no])),
    // Counted per book, oldest first — not by insertion order, not globally.
    { 'a-mid': 2, 'a-new': 3, 'a-old': 1, 'b-only': 1 },
  )

  // A re-run must not renumber anything a person has already seen on screen.
  await applyMigration(db, M083)
  const again = await db.query('SELECT id, order_no FROM order_requests ORDER BY id')
  assert.deepEqual(again.rows, rows)
  await db.close()
})

test('083: a new order gets the next number on its own book, whoever inserts it', { skip: !PGlite }, async () => {
  // The trigger is the point: insertOrder, the seed and every hand-written
  // fixture insert without naming order_no, and all of them must get one.
  const db = await freshDb()
  await db.exec(`
    INSERT INTO users (id, name, email, role) VALUES ('u1','Esra','e@e.com','satis');
    INSERT INTO projects (id, title, type, stage) VALUES ('pa','A','TR','satista'), ('pb','B','TR','satista');
    INSERT INTO order_requests (id, project_id, requested_by) VALUES ('a1','pa','u1');
    INSERT INTO order_requests (id, project_id, requested_by) VALUES ('a2','pa','u1'), ('b1','pb','u1'), ('a3','pa','u1');
  `)
  const { rows } = await db.query('SELECT id, order_no FROM order_requests ORDER BY id')
  assert.deepEqual(
    Object.fromEntries(rows.map((r) => [r.id, r.order_no])),
    { a1: 1, a2: 2, a3: 3, b1: 1 },
    'one multi-row INSERT must still hand out distinct numbers',
  )
  await db.close()
})

test('083: two orders on one book can never share a number', { skip: !PGlite }, async () => {
  const db = await freshDb()
  await db.exec(`
    INSERT INTO users (id, name, email, role) VALUES ('u1','Esra','e@e.com','satis');
    INSERT INTO projects (id, title, type, stage) VALUES ('pa','A','TR','satista'), ('pb','B','TR','satista');
    INSERT INTO order_requests (id, project_id, requested_by) VALUES ('a1','pa','u1');
  `)
  await assert.rejects(
    () => db.query("INSERT INTO order_requests (id, project_id, requested_by, order_no) VALUES ('dup','pa','u1',1)"),
    /ux_order_requests_project_order_no/,
    'two "Sipariş #1" cards on one book is exactly what the column exists to prevent',
  )
  // The same number on a different book is fine — the title tells them apart.
  await db.query("INSERT INTO order_requests (id, project_id, requested_by, order_no) VALUES ('b1','pb','u1',1)")
  await assert.rejects(
    () => db.query("UPDATE order_requests SET order_no = NULL WHERE id = 'a1'"),
    'order_no must be NOT NULL',
  )
  await db.close()
})

/* ==========================================================================
 *  084 — the designer batch counter goes back to a shared additive model
 * ======================================================================== */

test('084: start_page and its overlap-probe index are gone', { skip: !PGlite }, async () => {
  // 072 added both; 084 removes both. If either survives, the route can still
  // reject perfectly reasonable "+N" saves under the old slot-overlap rule —
  // which is exactly what this migration exists to stop.
  const db = await freshDb()

  const col = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'subtask_designer_batches'
        AND column_name = 'start_page'`,
  )
  assert.equal(col.rows.length, 0, 'start_page still on the table — the slot model was supposed to be gone')

  const idx = await db.query(
    `SELECT indexname FROM pg_indexes
      WHERE tablename = 'subtask_designer_batches'
        AND indexname = 'idx_subtask_designer_batches_subtask_start'`,
  )
  assert.equal(idx.rows.length, 0, 'the overlap-probe index outlived the column it served')

  await db.close()
})

test('084: the trigger still sums batches per kind and recomputes downward on delete', { skip: !PGlite }, async () => {
  // The whole point of dropping start_page is that recompute_subtask_pages_counter
  // never read it — it sums `pages` across every batch on the subtask and lands
  // the total on pages_done (or stickers_done, for sticker-count). Two designers
  // each shipping "+N" must land at N+N on the shared counter, and deleting one
  // of those batches has to walk the total back down, not just accumulate.
  const db = await freshDb()
  await db.exec(`
    INSERT INTO users (id, name, email, role) VALUES
      ('d1','Ayşe','a@e.com','designer'), ('d2','Mehmet','m@e.com','designer');
    INSERT INTO projects (id, title, type, stage) VALUES ('p1','Kitap','TR','tasarim');
    INSERT INTO subtasks (id, project_id, title, kind, total_pages, total_stickers) VALUES
      ('pg','p1','İç Sayfalar','pages',5,NULL),
      ('st','p1','Sticker','sticker-count',NULL,20);
    INSERT INTO subtask_designer_batches (id, subtask_id, designer_id, pages) VALUES
      ('b-pg-1','pg','d1',3),
      ('b-pg-2','pg','d2',2),
      ('b-st-1','st','d1',6),
      ('b-st-2','st','d2',4);
  `)

  const seeded = await db.query(
    'SELECT id, pages_done, stickers_done, is_done FROM subtasks ORDER BY id',
  )
  const byId = Object.fromEntries(seeded.rows.map((r) => [r.id, r]))
  assert.equal(byId.pg.pages_done, 5, '3 + 2 = 5 on the shared page counter')
  assert.equal(byId.pg.is_done, true, 'pages_done met total_pages, is_done must flip')
  assert.equal(byId.st.stickers_done, 10, '6 + 4 = 10 on the shared sticker counter')
  assert.equal(byId.st.is_done, false, 'stickers_done is still short of total_stickers')

  // Deleting a batch has to retract the credit; without a downward recompute
  // the counter would drift high after every "Sil" click and is_done would
  // stay ticked on a subtask that isn't finished any more.
  await db.query("DELETE FROM subtask_designer_batches WHERE id = 'b-pg-2'")
  const afterDelete = await db.query(
    "SELECT pages_done, is_done FROM subtasks WHERE id = 'pg'",
  )
  assert.deepEqual(
    afterDelete.rows[0], { pages_done: 3, is_done: false },
    'DELETE must recompute pages_done downward and un-flip is_done',
  )

  await db.close()
})
