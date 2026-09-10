/**
 * A sipariş's ozalit round, driven parça by parça through a real database.
 *
 * This is the test the feature exists for. Every rule it checks is one the
 * project pipeline already enforces, and the point of the sipariş work was to
 * make the two behave identically — so what is asserted here is not "the code
 * runs" but "a reprint of a three-parça book behaves exactly like the project
 * round of the same book".
 *
 * Real Postgres (PGlite) rather than a fake client, because the interesting
 * parts are all database behaviour: the partial-index upsert, a status that
 * must NOT move while two of three parçalar are outstanding, and a ledger read
 * back across several transactions.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as svc from './order-parca-service.js'
import { advanceOrder } from './orders-service.js'
import { listParcaStateForOrder } from './parca-state-repository.js'

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations',
)

let PGlite = null
try {
  ({ PGlite } = await import('@electric-sql/pglite'))
} catch {
  // eslint-disable-next-line no-console
  console.log('[order-parca-service.integration] pglite not installed — skipping')
}

const PRINTER = { id: 'u-oktay', role: 'printer', name: 'Oktay' }
const LEADER = { id: 'u-ayse', role: 'team_leader', name: 'Ayşenur' }
const DESIGNER = { id: 'u-aylin', role: 'designer', name: 'Aylin' }
const PARCALAR = ['KUTU', 'KİTAP', 'KILAVUZ']

/**
 * A three-parça sipariş sitting with the matbaa.
 *
 * The `demos` row is the round's sheet — `_selectedComponents` is what the
 * designer ticked in the Ozalit Üretim Formu, and it is the ONLY thing that
 * says which parçalar this round carries. No parca_state rows are seeded: they
 * are materialised on first action, which is exactly the path under test.
 */
async function seeded({ parcalar = PARCALAR, status = 'matbaa_ozalit_yapiyor' } = {}) {
  const db = new PGlite()
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => /^\d{3}__.+\.sql$/.test(f)).sort()
  for (const f of files) {
    await db.exec(`BEGIN; ${await fs.readFile(path.join(MIGRATIONS_DIR, f), 'utf8')} ; COMMIT;`)
  }
  await db.query(
    `INSERT INTO users (id, name, email, role) VALUES
       ($1,'Oktay','o@e.com','printer'), ($2,'Ayşenur','a@e.com','team_leader'),
       ($3,'Aylin','ay@e.com','designer'), ('u-esra','Esra','e@e.com','satis')`,
    [PRINTER.id, LEADER.id, DESIGNER.id],
  )
  await db.exec(`
    INSERT INTO projects (id, title, type, stage) VALUES ('p1','KEÇEMİNO ÇİFTLİK','TR','baskida');
  `)
  await db.query(
    `INSERT INTO order_requests (id, project_id, requested_by, status, assignee_ids, ozalit_attempt)
     VALUES ('o1','p1','u-esra',$1,$2::jsonb,1)`,
    [status, JSON.stringify([DESIGNER.id])],
  )
  await db.query(
    // demos.id has no default — the app supplies a nanoid, so the fixture must too.
    `INSERT INTO demos (id, project_id, order_id, kind, attempt, payload)
     VALUES ('d1','p1','o1','ozalit',1,$1::jsonb)`,
    [JSON.stringify({ _selectedComponents: parcalar })],
  )
  return db
}

const statusOf = async (db) =>
  (await db.query("SELECT status FROM order_requests WHERE id = 'o1'")).rows[0].status

test('the matbaa works one parça at a time; the order waits for the last', { skip: !PGlite }, async () => {
  const db = await seeded()

  // Nothing is seeded, so the queue has to DERIVE all three from the sheet.
  const queue = await svc.listMyOrderParcaQueue(PRINTER, db)
  assert.deepEqual(
    queue.map((r) => r.parca).sort(), [...PARCALAR].sort(),
    'the printer should see one card per parça on a round nobody has touched',
  )
  assert.ok(queue.every((r) => r.order_id === 'o1'), 'rows must carry order_id so the client can route them')

  await svc.startOrderParca('o1', 'KUTU', PRINTER, db)
  const started = await listParcaStateForOrder(db, 'o1')
  assert.equal(started.length, 1, 'acting on one parça must not materialise the others')
  assert.equal(started[0].state, 'in_round')

  await svc.deliverOrderParca('o1', 'KUTU', PRINTER, db)
  assert.equal(
    await statusOf(db), 'matbaa_ozalit_yapiyor',
    'delivering ONE of three parçalar must not advance the order',
  )

  // KUTU is back at the gate and off the printer's desk; the other two remain.
  const afterOne = await svc.listMyOrderParcaQueue(PRINTER, db)
  assert.deepEqual(
    afterOne.map((r) => r.parca).sort(), ['KILAVUZ', 'KİTAP'],
    'a delivered parça leaves the matbaa queue, its siblings stay',
  )

  for (const parca of ['KİTAP', 'KILAVUZ']) {
    await svc.startOrderParca('o1', parca, PRINTER, db)
    await svc.deliverOrderParca('o1', parca, PRINTER, db)
  }
  assert.equal(
    await statusOf(db), 'imza_bekleniyor',
    'the LAST delivery advances the order to the approval gate',
  )
  await db.close()
})

test('a delivery resets the receipt so each proof is acknowledged afresh', { skip: !PGlite }, async () => {
  const db = await seeded()
  // Pretend an earlier round was acknowledged — the flag the approval gate reads.
  await db.exec("UPDATE order_requests SET matbaa_received = TRUE WHERE id = 'o1'")

  await svc.startOrderParca('o1', 'KUTU', PRINTER, db)
  await svc.deliverOrderParca('o1', 'KUTU', PRINTER, db)

  const { rows } = await db.query("SELECT matbaa_received FROM order_requests WHERE id = 'o1'")
  assert.equal(
    rows[0].matbaa_received, false,
    'a fresh physical delivery must re-open the receipt gate, or the new proof '
    + 'could be approved without anyone confirming it arrived',
  )
  await db.close()
})

test('per-parça Teslim Alındı, and who may give it', { skip: !PGlite }, async () => {
  const db = await seeded()
  await svc.startOrderParca('o1', 'KUTU', PRINTER, db)
  await svc.deliverOrderParca('o1', 'KUTU', PRINTER, db)

  await assert.rejects(
    () => svc.receiveOrderParca('o1', 'KUTU', PRINTER, db),
    /yalnızca ekip lideri veya atanmış tasarımcı/,
    'the matbaa cannot acknowledge their own delivery',
  )

  const received = await svc.receiveOrderParca('o1', 'KUTU', LEADER, db)
  assert.ok(received.received_at)
  assert.equal(received.received_by, LEADER.id)

  // Idempotent: the same fact stated twice is not an error.
  const again = await svc.receiveOrderParca('o1', 'KUTU', LEADER, db)
  assert.equal(again.received_at.toISOString?.() ?? again.received_at,
    received.received_at.toISOString?.() ?? received.received_at)
  await db.close()
})

test('a second tap on Teslim Edin is not an error', { skip: !PGlite }, async () => {
  const db = await seeded()
  await svc.startOrderParca('o1', 'KUTU', PRINTER, db)
  await svc.deliverOrderParca('o1', 'KUTU', PRINTER, db)
  // Delivering CLEARS owner_role, so a naive second call fails canActOnParca
  // with "Bu parça sizde değil." on a parça the printer just delivered — the
  // dead end the project twin documents. Two taps on a phone is all it takes.
  const twice = await svc.deliverOrderParca('o1', 'KUTU', PRINTER, db)
  assert.equal(twice.state, 'pending')
  await db.close()
})

test('delivery refuses before İşlemi Başlatın', { skip: !PGlite }, async () => {
  const db = await seeded()
  await assert.rejects(
    () => svc.deliverOrderParca('o1', 'KUTU', PRINTER, db),
    /İşlemi Başlatın/,
  )
  await db.close()
})

/* ==========================================================================
 *  The change-request handshake, per parça
 * ======================================================================== */

test('the leader can ask about ONE parça, and an accept un-starts only that one', { skip: !PGlite }, async () => {
  const db = await seeded()
  await svc.startOrderParca('o1', 'KUTU', PRINTER, db)
  await svc.startOrderParca('o1', 'KİTAP', PRINTER, db)

  await svc.requestOrderParcaChange('o1', 'KUTU', LEADER, { note: 'kapak rengi' }, db)
  const asked = (await listParcaStateForOrder(db, 'o1')).find((r) => r.parca === 'KUTU')
  assert.equal(asked.change_requested_note, 'kapak rengi')

  await svc.acceptOrderParcaChange('o1', 'KUTU', PRINTER, db)
  const rows = await listParcaStateForOrder(db, 'o1')
  const kutu = rows.find((r) => r.parca === 'KUTU')
  const kitap = rows.find((r) => r.parca === 'KİTAP')

  assert.equal(kutu.fix_pending, true, 'accepting owes the leader a correction')
  assert.equal(kutu.started_at, null, 'accepting un-starts the parça')
  assert.equal(kitap.started_at != null, true, 'the OTHER parça keeps running — that is the whole feature')

  await assert.rejects(
    () => svc.startOrderParca('o1', 'KUTU', PRINTER, db),
    /düzeltme bekleniyor/,
    're-starting before the correction lands would put the matbaa back on the version everyone agreed was wrong',
  )
  await db.close()
})

test('a declined change leaves the parça exactly where it was', { skip: !PGlite }, async () => {
  const db = await seeded()
  await svc.startOrderParca('o1', 'KUTU', PRINTER, db)
  await svc.requestOrderParcaChange('o1', 'KUTU', LEADER, {}, db)
  await svc.declineOrderParcaChange('o1', 'KUTU', PRINTER, db)

  const kutu = (await listParcaStateForOrder(db, 'o1')).find((r) => r.parca === 'KUTU')
  assert.equal(kutu.change_requested_at, null, 'the question is cleared')
  assert.equal(kutu.owner_role, 'printer', 'but the parça stays theirs')
  assert.ok(kutu.started_at, 'and stays started')

  // The row must still be in their queue — the migration-078 bug was exactly
  // this patch dropping owner_role and stranding the parça with nobody.
  const queue = await svc.listMyOrderParcaQueue(PRINTER, db)
  assert.ok(queue.some((r) => r.parca === 'KUTU'), 'a declined parça must not vanish from the queue')
  await db.close()
})

/* ==========================================================================
 *  The designer's re-round, and the Ekran rule
 * ======================================================================== */

test('a rejected parça goes back round physically, to the matbaa alone', { skip: !PGlite }, async () => {
  const db = await seeded({ status: 'imza_bekleniyor' })
  await db.exec(`
    INSERT INTO parca_state (project_id, order_id, parca, gate, state, owner_role, attempt)
    VALUES ('p1','o1','KUTU','ozalit','with_designer','designer',2);
  `)

  await svc.requestOrderParcaRound('o1', 'KUTU', DESIGNER, { route: 'physical' }, db)
  const kutu = (await listParcaStateForOrder(db, 'o1')).find((r) => r.parca === 'KUTU')
  assert.equal(kutu.state, 'with_matbaa')
  assert.equal(kutu.owner_role, 'printer')
  assert.equal(kutu.route, 'physical')
  assert.equal(kutu.attempt, 2, 'the round number survives the hand-off')
  await db.close()
})

test('an Ekran round skips the matbaa and returns to the gate at once', { skip: !PGlite }, async () => {
  const db = await seeded({ status: 'imza_bekleniyor' })
  await db.query(
    `UPDATE order_requests SET ozalit_parca_rejections = $1::jsonb WHERE id = 'o1'`,
    [JSON.stringify([{ parca: 'KUTU', by: LEADER.id, reason: 'kerning', target: 'designer' }])],
  )
  await db.exec(`
    INSERT INTO parca_state (project_id, order_id, parca, gate, state, owner_role, attempt)
    VALUES ('p1','o1','KUTU','ozalit','with_designer','designer',2);
  `)

  await svc.requestOrderParcaRound('o1', 'KUTU', DESIGNER, { route: 'ekran' }, db)

  const kutu = (await listParcaStateForOrder(db, 'o1')).find((r) => r.parca === 'KUTU')
  assert.equal(kutu.state, 'pending', 'an ekran round is back at the gate immediately')
  assert.equal(kutu.owner_role, null, 'on nobody\'s desk — there is nothing to print')
  assert.equal(kutu.route, 'ekran')

  // The rejection row is cleared NOW, not on delivery, because there will be
  // no delivery. Leaving it would make the parça read "Reddedildi" forever.
  const { rows } = await db.query("SELECT ozalit_parca_rejections FROM order_requests WHERE id = 'o1'")
  assert.deepEqual(rows[0].ozalit_parca_rejections, [], 'the ekran leg settles the rejection itself')

  // And it must never appear in the matbaa's queue — they were skipped.
  const queue = await svc.listMyOrderParcaQueue(PRINTER, db)
  assert.ok(!queue.some((r) => r.parca === 'KUTU'), 'an ekran parça is not the matbaa\'s work')
  await db.close()
})

test('only the assigned designer or a leader may send a parça back round', { skip: !PGlite }, async () => {
  const db = await seeded({ status: 'imza_bekleniyor' })
  await db.exec(`
    INSERT INTO parca_state (project_id, order_id, parca, gate, state, owner_role)
    VALUES ('p1','o1','KUTU','ozalit','with_designer','designer');
  `)
  await assert.rejects(
    () => svc.requestOrderParcaRound('o1', 'KUTU', { id: 'u-other', role: 'designer' }, { route: 'physical' }, db),
    /atanmış tasarımcı veya ekip lideri/,
  )
  await db.close()
})

/* ==========================================================================
 *  The single-parça escape hatch
 * ======================================================================== */

test('a one-parça reprint keeps its old whole-order behaviour', { skip: !PGlite }, async () => {
  const db = await seeded({ parcalar: ['KAPAK'] })

  // No per-parça cards: splitting a one-parça sheet into a queue of one is
  // noise, and the order row already says everything. This is what keeps the
  // feature from changing how an ordinary reprint looks.
  const queue = await svc.listMyOrderParcaQueue(PRINTER, db)
  assert.deepEqual(queue, [], 'a single-parça round shows no parça cards')

  // And the gate treats it as complete without any parça rows at all, so the
  // existing whole-sheet Teslim Edin still advances it.
  assert.equal(await svc.allOrderParcalarDelivered(db, 'o1'), true)
  await db.close()
})

test('the designer only sees parçalar of orders they are assigned to', { skip: !PGlite }, async () => {
  const db = await seeded({ status: 'imza_bekleniyor' })
  await db.exec(`
    INSERT INTO parca_state (project_id, order_id, parca, gate, state, owner_role)
    VALUES ('p1','o1','KUTU','ozalit','with_designer','designer');
  `)
  const mine = await svc.listMyOrderParcaQueue(DESIGNER, db)
  assert.deepEqual(mine.map((r) => r.parca), ['KUTU'])

  const theirs = await svc.listMyOrderParcaQueue({ id: 'u-other', role: 'designer' }, db)
  assert.deepEqual(theirs, [], 'another designer must not see this order\'s parçalar')
  await db.close()
})

/* ==========================================================================
 *  The whole-order advance, on a split round
 *
 *  The queues hide the whole-order card once a round splits, but hiding a
 *  card does not close an endpoint. A stale tab, a queued request, a deep
 *  link or curl all reach `advance` exactly as before — and a whole-sheet
 *  "Teslim Edin" on a three-parça round would hand the leader an approval
 *  gate for two proofs that were never printed.
 * ======================================================================== */

test('a whole-order Teslim Edin is refused while the round is split', { skip: !PGlite }, async () => {
  const db = await seeded()
  // Exactly the state a stale tab would be in: the printer marked the WHOLE
  // sheet started before the round was split into parçalar, so the older
  // `ozalit_started` guard is satisfied and only the split-round check stands
  // between this click and an unearned advance.
  await db.exec("UPDATE order_requests SET ozalit_started = TRUE WHERE id = 'o1'")

  await assert.rejects(
    () => advanceOrder('o1', PRINTER, {}, db),
    /parça bazlı yürüyor/,
    'the endpoint must refuse, not merely be un-clickable',
  )
  assert.equal(await statusOf(db), 'matbaa_ozalit_yapiyor', 'and the order must not have moved')
  await db.close()
})

test('a one-parça round still delivers in one click', { skip: !PGlite }, async () => {
  const db = await seeded({ parcalar: ['KAPAK'] })
  await db.exec("UPDATE order_requests SET ozalit_started = TRUE WHERE id = 'o1'")

  // The guard must not touch an ordinary reprint. Nothing about a single-parça
  // order changed, and the whole-order path is still its only path.
  await advanceOrder('o1', PRINTER, {}, db)
  assert.equal(await statusOf(db), 'imza_bekleniyor')
  await db.close()
})

test('the per-parça path is the one way a split round advances', { skip: !PGlite }, async () => {
  const db = await seeded()
  for (const parca of PARCALAR) {
    await svc.startOrderParca('o1', parca, PRINTER, db)
    await svc.deliverOrderParca('o1', parca, PRINTER, db)
  }
  assert.equal(
    await statusOf(db), 'imza_bekleniyor',
    'deliverOrderParca sets parcaRoundComplete, which is the only legitimate way past the guard',
  )
  await db.close()
})
