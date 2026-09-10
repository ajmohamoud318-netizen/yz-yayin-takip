/**
 * The sipariş teslim leg (migration 081), driven through a real database.
 *
 * This is the test the feature exists for. The hole it closes is not a rule
 * that behaved wrongly — it is a run that could not finish at all: a reprint
 * of a book already `satista` cleared baskı onayı, its copies shipped, and
 * nothing in the system could record that they had. The order sat at
 * `baskida` for the life of the product.
 *
 * So what is asserted here is mostly about what does NOT happen. The project's
 * stage must not move (that is the whole reason the order needed its own
 * leg), no notification may claim it did, and `/advance` must not be able to
 * reach the terminal state that satış alone is allowed to write.
 *
 * Real Postgres (PGlite) rather than a fake client, because the interesting
 * parts are database behaviour: two partial unique indexes standing in for one
 * primary-key-shaped guard, a status CHECK that has to accept a value added
 * after every existing row was written, and a cross-aggregate command that
 * must commit with the receipt or not at all.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { confirmOrderHandover } from './orders-service.js'
import { canRequestOrderHandover } from '../domain/pipeline.js'
import { schemas } from '../schemas/index.js'

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations',
)

let PGlite = null
try {
  ({ PGlite } = await import('@electric-sql/pglite'))
} catch {
  // eslint-disable-next-line no-console
  console.log('[order-handover.integration] pglite not installed — skipping')
}

let Fastify = null
try {
  ({ default: Fastify } = await import('fastify'))
} catch {
  // eslint-disable-next-line no-console
  console.log('[order-handover.integration] fastify not installed — skipping schema tests')
}

const SATIS = { id: 'u-esra', role: 'satis', name: 'Esra' }
const PRINTER = { id: 'u-oktay', role: 'printer', name: 'Oktay' }
const LEADER = { id: 'u-ayse', role: 'team_leader', name: 'Ayşenur' }

/**
 * A reprint that has cleared baskı onayı, on a book that is already selling.
 *
 * `stage: 'satista'` is the case with no path before this migration: the
 * project is long past its own handover stage, so `canRequestHandover` is
 * false and the project-scoped teslim can never be raised for these copies.
 */
async function seeded({ orderStatus = 'baskida', stage = 'satista' } = {}) {
  const db = new PGlite()
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => /^\d{3}__.+\.sql$/.test(f)).sort()
  for (const f of files) {
    await db.exec(`BEGIN; ${await fs.readFile(path.join(MIGRATIONS_DIR, f), 'utf8')} ; COMMIT;`)
  }
  await db.query(
    `INSERT INTO users (id, name, email, role) VALUES
       ($1,'Esra','e@e.com','satis'), ($2,'Oktay','o@e.com','printer'),
       ($3,'Ayşenur','a@e.com','team_leader')`,
    [SATIS.id, PRINTER.id, LEADER.id],
  )
  await db.query(
    'UPDATE users SET is_active = FALSE WHERE id <> ALL($1::text[])',
    [[SATIS.id, PRINTER.id, LEADER.id]],
  )
  await db.query(
    "INSERT INTO projects (id, title, type, stage) VALUES ('p1','KEÇEMİNO ÇİFTLİK','TR',$1)",
    [stage],
  )
  await db.query(
    `INSERT INTO order_requests (id, project_id, requested_by, status)
     VALUES ('o1','p1',$1,$2)`,
    [SATIS.id, orderStatus],
  )
  return db
}

const orderStatus = async (db) =>
  (await db.query("SELECT status FROM order_requests WHERE id = 'o1'")).rows[0].status
const projectStage = async (db) =>
  (await db.query("SELECT stage FROM projects WHERE id = 'p1'")).rows[0].stage

test('a reprint of a selling book is the case with no other path', { skip: !PGlite }, async () => {
  const db = await seeded()
  // The two halves of the hole, stated together: the project cannot be handed
  // over, and before migration 081 neither could the order.
  const project = (await db.query("SELECT * FROM projects WHERE id = 'p1'")).rows[0]
  assert.equal(project.stage, 'satista')
  assert.equal(canRequestOrderHandover({ status: await orderStatus(db) }), true)
  await db.close()
})

test('satış confirming the teslim closes the ORDER and moves nothing else', { skip: !PGlite }, async () => {
  const db = await seeded()

  const updated = await confirmOrderHandover('o1', SATIS, db)

  assert.equal(updated.status, 'teslim_edildi', 'the run is finished')
  assert.equal(
    await projectStage(db), 'satista',
    'the project must not move: it has been on sale the whole time',
  )

  // Both timelines carry it — the order's, so the reprint tells its own story,
  // and the project's, so the book's page shows the delivery.
  const { rows: history } = await db.query(
    "SELECT step, notes FROM order_history WHERE order_id = 'o1' ORDER BY created_at",
  )
  assert.equal(history.at(-1).step, 'teslim_edildi')

  const { rows: timeline } = await db.query(
    "SELECT event, from_stage, to_stage, note FROM stage_history WHERE project_id = 'p1'",
  )
  assert.equal(timeline.length, 1)
  assert.equal(timeline[0].event, 'order_handover_confirmed')
  assert.equal(
    timeline[0].from_stage, timeline[0].to_stage,
    'a timeline row claiming a stage change would be a lie about a sold book',
  )
  assert.ok(
    !/satış|satışta/i.test(timeline[0].note),
    `the note must not announce a sale that did not happen: ${timeline[0].note}`,
  )
  await db.close()
})

test('confirming twice is a no-op, not an error', { skip: !PGlite }, async () => {
  const db = await seeded()
  const first = await confirmOrderHandover('o1', SATIS, db)
  const second = await confirmOrderHandover('o1', SATIS, db)

  assert.equal(second.status, 'teslim_edildi')
  assert.equal(
    second.version, first.version,
    'an idempotent confirm must not bump the version — a stale tab would 409 forever',
  )
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM order_history WHERE order_id = 'o1' AND step = 'teslim_edildi'",
  )
  assert.equal(rows[0].n, 1, 'and must not write a second timeline row')
  await db.close()
})

test('a run that has not been printed cannot be delivered', { skip: !PGlite }, async () => {
  const db = await seeded({ orderStatus: 'imza_bekleniyor' })
  await assert.rejects(
    () => confirmOrderHandover('o1', SATIS, db),
    /baskısı tamamlanmış/,
  )
  assert.equal(await orderStatus(db), 'imza_bekleniyor', 'and the order must not move')
  await db.close()
})

test('only satış may close a run — not the matbaa who delivered it', { skip: !PGlite }, async () => {
  const db = await seeded()
  // The gate that makes the record worth keeping: the party handing the copies
  // over cannot also sign for having received them.
  await assert.rejects(() => confirmOrderHandover('o1', PRINTER, db), /yalnızca satış/)
  await assert.rejects(() => confirmOrderHandover('o1', LEADER, db), /yalnızca satış/)
  assert.equal(await orderStatus(db), 'baskida')
  await db.close()
})

// The DDL guarantees this leg rests on — the two partial unique indexes, the
// cascade, the widened status CHECK and the backfill — are asserted against a
// real schema in db/migrations.test.js, which is where this repo keeps
// per-migration assertions. This file stays on behaviour.

/* ---------------------------------------------------------------------------
 * The request body accepts exactly one id.
 *
 * Checked through Fastify's own validator rather than by reading the schema:
 * `oneOf` with a `not: { required: [...] }` on each branch is easy to write in
 * a way that quietly accepts both ids, and the route branches on which one is
 * present — so "both" would silently become "whichever we checked first".
 * ------------------------------------------------------------------------- */

async function bodyValidator() {
  // The SAME ajv options index.js builds the real server with. Fastify 5's
  // defaults strip unknown body keys instead of refusing them
  // (`removeAdditional: true`), so a validator built with bare defaults would
  // quietly disagree with production about `additionalProperties: false` —
  // and this test would assert behaviour no request ever sees.
  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false, useDefaults: true, coerceTypes: false } },
  })
  app.post('/handovers', { schema: schemas.handoversCreate }, async () => ({ ok: true }))
  await app.ready()
  return async (payload) => (await app.inject({ method: 'POST', url: '/handovers', payload })).statusCode
}

test('POST /handovers takes a projectId or an orderId, never both or neither', { skip: !Fastify }, async () => {
  const status = await bodyValidator()

  assert.equal(await status({ projectId: 'p1' }), 200, "a project's own teslim")
  assert.equal(await status({ orderId: 'o1' }), 200, "a reprint's teslim")
  assert.equal(await status({ projectId: 'p1', orderId: 'o1' }), 400, 'both is ambiguous')
  assert.equal(await status({}), 400, 'neither names anything to hand over')
  assert.equal(await status({ orderId: 'o1', nope: 1 }), 400, 'unknown properties stay refused')
})
