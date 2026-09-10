/**
 * parca-state-repository against a REAL Postgres (PGlite, in-process WASM).
 *
 * The unit tests elsewhere drive a fake pg client and assert the SQL we meant
 * to send. That cannot answer the two questions this file exists for:
 *
 *   1. Does `ON CONFLICT (project_id, parca) WHERE order_id IS NULL` actually
 *      infer the partial index migration 080 created? Postgres is strict about
 *      partial-index inference and refuses outright when the predicate doesn't
 *      match — a failure no fake client can produce.
 *
 *   2. Do the two pipelines really stay out of each other's way? The project's
 *      KUTU and a sipariş's KUTU are different rows that were, until 080, the
 *      same primary key. Every guarantee here is about rows NOT colliding, NOT
 *      overwriting, and NOT leaking into each other's queries — all of them
 *      properties of the database, not of our SQL strings.
 *
 * See db/migrations.test.js for the same reasoning applied to the DDL itself.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as repo from './parca-state-repository.js'
import { parcaStartPatch, parcaDeliverPatch } from '../domain/parca-routing.js'

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations',
)

let PGlite = null
try {
  ({ PGlite } = await import('@electric-sql/pglite'))
} catch {
  // eslint-disable-next-line no-console
  console.log('[parca-state-repository.integration] pglite not installed — skipping')
}

/** A migrated database seeded with one project and two orders against it. */
async function seeded() {
  const db = new PGlite()
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => /^\d{3}__.+\.sql$/.test(f)).sort()
  for (const f of files) {
    await db.exec(`BEGIN; ${await fs.readFile(path.join(MIGRATIONS_DIR, f), 'utf8')} ; COMMIT;`)
  }
  await db.exec(`
    INSERT INTO users (id, name, email, role) VALUES ('u1','Ayşenur','a@e.com','team_leader');
    INSERT INTO projects (id, title, type, stage) VALUES ('p1','Kitap','TR','ozalit_teslim');
    INSERT INTO order_requests (id, project_id, requested_by, status)
      VALUES ('o1','p1','u1','matbaa_ozalit_yapiyor'), ('o2','p1','u1','matbaa_ozalit_yapiyor');
  `)
  return db
}

const OZALIT_ROUND = { gate: 'ozalit', state: 'with_matbaa', owner_role: 'printer' }

test('the project upsert inserts, then UPDATEs through the partial arbiter', { skip: !PGlite }, async () => {
  const db = await seeded()

  const created = await repo.upsertParcaState(db, 'p1', 'KUTU', OZALIT_ROUND)
  assert.equal(created.order_id, null)
  assert.equal(created.state, 'with_matbaa')

  // A patch that carries neither gate nor state must find the stored row and
  // keep both. If the arbiter failed to infer, this would raise; if it
  // inserted a second row instead, the count below would be 2.
  const patched = await repo.upsertParcaState(db, 'p1', 'KUTU', { started_at: '2026-09-10T00:00:00Z' })
  assert.equal(patched.gate, 'ozalit', 'gate was not carried through the conflict path')
  assert.equal(patched.state, 'with_matbaa', 'state was not carried through the conflict path')
  assert.ok(patched.started_at)

  const { rows } = await db.query('SELECT count(*)::int AS n FROM parca_state WHERE order_id IS NULL')
  assert.equal(rows[0].n, 1, 'the conflict path inserted a duplicate instead of updating')
  await db.close()
})

test('a sipariş parça lives beside the project\'s own without touching it', { skip: !PGlite }, async () => {
  const db = await seeded()
  await repo.upsertParcaState(db, 'p1', 'KUTU', { ...OZALIT_ROUND, started_at: '2026-09-10T00:00:00Z' })
  await repo.upsertOrderParcaState(db, 'p1', 'o1', 'KUTU', OZALIT_ROUND)

  // The order upsert must not have written through to the project's row —
  // before 080 they were the same primary key.
  const { rows } = await db.query(
    "SELECT started_at FROM parca_state WHERE project_id = 'p1' AND order_id IS NULL",
  )
  assert.ok(rows[0].started_at, "the sipariş upsert clobbered the project's own parça")
  await db.close()
})

test('the sipariş upsert keeps every patch semantic the project one has', { skip: !PGlite }, async () => {
  const db = await seeded()
  await repo.upsertOrderParcaState(db, 'p1', 'o1', 'KUTU', { ...OZALIT_ROUND, attempt: 5 })

  // The migration-079 bug in its sipariş form: a state-only patch must not
  // reset the round counter. Both upserts are built from one template so they
  // cannot drift — this is what proves the template reached both.
  const started = await repo.upsertOrderParcaState(
    db, 'p1', 'o1', 'KUTU', parcaStartPatch({ now: '2026-09-10T02:00:00Z' }),
  )
  assert.equal(started.attempt, 5, 'a start patch reset the sipariş parça\'s round counter')
  assert.equal(started.owner_role, 'printer')
  assert.equal(started.state, 'in_round')

  // And the deliberate clear-by-omission half: delivering returns the parça to
  // the gate, so owner_role takes EXCLUDED verbatim rather than COALESCE-ing
  // the old owner back in.
  const delivered = await repo.upsertOrderParcaState(
    db, 'p1', 'o1', 'KUTU', parcaDeliverPatch({ now: '2026-09-10T03:00:00Z' }),
  )
  assert.equal(delivered.owner_role, null, 'owner_role should be cleared on delivery')
  assert.equal(delivered.state, 'pending')
  assert.ok(delivered.delivered_at)
  await db.close()
})

/* ==========================================================================
 *  Scoping — the rule migration 053 stated and 080 inherits:
 *  a project-scoped read MUST filter order_id IS NULL.
 * ======================================================================== */

test('project reads never see sipariş parçalar, and vice versa', { skip: !PGlite }, async () => {
  const db = await seeded()
  await repo.upsertParcaState(db, 'p1', 'KUTU', OZALIT_ROUND)
  await repo.upsertOrderParcaState(db, 'p1', 'o1', 'KUTU', OZALIT_ROUND)
  await repo.upsertOrderParcaState(db, 'p1', 'o2', 'KAPAK', OZALIT_ROUND)

  // This one feeds the PROJECT's approval gate. A sipariş parça leaking in
  // would count toward whether the project may advance.
  const projectRows = await repo.listParcaState(db, 'p1')
  assert.equal(projectRows.length, 1)
  assert.equal(projectRows[0].order_id, null)

  const orderRows = await repo.listParcaStateForOrder(db, 'o1')
  assert.equal(orderRows.length, 1)
  assert.equal(orderRows[0].order_id, 'o1')

  const projectQueue = await repo.listParcaStateByOwner(db, 'printer', ['with_matbaa', 'in_round'])
  assert.ok(
    projectQueue.every((r) => r.order_id === null),
    'sipariş rows leaked into the project queue',
  )

  const orderQueue = await repo.listOrderParcaStateByOwner(db, 'printer', ['with_matbaa', 'in_round'])
  assert.equal(orderQueue.length, 2)
  assert.ok(orderQueue.every((r) => r.project_title === 'Kitap'), 'the join lost the project title')
  await db.close()
})

test('a project round reset spares a sipariş that is in flight', { skip: !PGlite }, async () => {
  const db = await seeded()
  await repo.upsertParcaState(db, 'p1', 'KUTU', OZALIT_ROUND)
  await repo.upsertOrderParcaState(db, 'p1', 'o1', 'KUTU', OZALIT_ROUND)

  // Both match `project_id = 'p1' AND gate = 'ozalit'` — a reprint's round IS
  // an ozalit round on that project — so without the order_id filter the
  // leader resending a project ozalit would silently wipe the matbaa's live
  // sipariş routing, and the order's gate would read it as never delivered.
  await repo.deleteParcaStateForGate(db, 'p1', 'ozalit')

  const { rows } = await db.query('SELECT order_id FROM parca_state')
  assert.equal(rows.length, 1, 'the project reset took the sipariş parça with it')
  assert.equal(rows[0].order_id, 'o1')
  await db.close()
})

test('ensureOrderParcaRows seeds by union and never removes', { skip: !PGlite }, async () => {
  const db = await seeded()
  await repo.upsertOrderParcaState(db, 'p1', 'o1', 'KUTU', OZALIT_ROUND)

  const seededRows = await repo.ensureOrderParcaRows(db, 'p1', 'o1', ['KUTU', 'KILAVUZ'])
  assert.deepEqual(seededRows.map((r) => r.parca), ['KILAVUZ'], 'only the missing parça should be inserted')

  const kept = await repo.listParcaStateForOrder(db, 'o1')
  assert.deepEqual(kept.map((r) => r.parca).sort(), ['KILAVUZ', 'KUTU'])
  assert.equal(
    kept.find((r) => r.parca === 'KUTU').owner_role, 'printer',
    'seeding overwrote a parça that was already routed',
  )
  await db.close()
})
