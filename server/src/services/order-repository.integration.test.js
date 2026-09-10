/**
 * `order_requests` column allowlists, checked against the live schema.
 *
 * `updateOrder` filters every write through `ORDER_WRITABLE_COLUMNS` and drops
 * what isn't there — silently. No error, no warning: the UPDATE is built
 * without that column, Postgres accepts it, and the caller gets a successful
 * result for a write that never happened. A column added to the schema and
 * forgotten here produces a feature that appears to work and persists nothing.
 *
 * `ORDER_JSONB_COLUMNS` fails more loudly but just as confusingly: node-pg
 * renders a bare JS array as a Postgres array literal (`{a,b}`), which a jsonb
 * column rejects at runtime — so a jsonb column missing from that set is a
 * 500 on first use rather than a quiet no-op.
 *
 * Neither set can be checked by reading the file. Both are checked here
 * against the columns the migrations actually created.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ORDER_WRITABLE_COLUMNS, ORDER_JSONB_COLUMNS, listOrders } from './order-repository.js'

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations',
)

let PGlite = null
try {
  ({ PGlite } = await import('@electric-sql/pglite'))
} catch {
  // eslint-disable-next-line no-console
  console.log('[order-repository.integration] pglite not installed — skipping')
}

/** { column_name: data_type } for order_requests, straight from the schema. */
async function orderColumns() {
  const db = new PGlite()
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => /^\d{3}__.+\.sql$/.test(f)).sort()
  for (const f of files) {
    await db.exec(`BEGIN; ${await fs.readFile(path.join(MIGRATIONS_DIR, f), 'utf8')} ; COMMIT;`)
  }
  const { rows } = await db.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'order_requests'`,
  )
  await db.close()
  return new Map(rows.map((r) => [r.column_name, r.data_type]))
}

test('every writable column actually exists on order_requests', { skip: !PGlite }, async () => {
  const cols = await orderColumns()
  const ghosts = [...ORDER_WRITABLE_COLUMNS].filter((c) => !cols.has(c))
  assert.deepEqual(
    ghosts, [],
    `allowlisted columns that do not exist — every write to these is silently dropped: ${ghosts}`,
  )
})

test('every jsonb column listed is really jsonb, and vice versa', { skip: !PGlite }, async () => {
  const cols = await orderColumns()

  const notJsonb = [...ORDER_JSONB_COLUMNS].filter((c) => cols.get(c) !== 'jsonb')
  assert.deepEqual(notJsonb, [], `listed as jsonb but are not: ${notJsonb}`)

  // The direction that actually bites: a jsonb column that IS writable but is
  // missing from the cast set throws on first use, because node-pg sends a JS
  // array as a Postgres array literal.
  const missingCast = [...ORDER_WRITABLE_COLUMNS]
    .filter((c) => cols.get(c) === 'jsonb' && !ORDER_JSONB_COLUMNS.has(c))
  assert.deepEqual(
    missingCast, [],
    `writable jsonb columns missing from ORDER_JSONB_COLUMNS — these throw on write: ${missingCast}`,
  )
})

test('the per-parça ledgers from migration 080 are writable and cast', { skip: !PGlite }, async () => {
  // Pinned by name rather than left to the generic checks above: these four are
  // the whole point of 080, and a rename that dropped one would otherwise only
  // surface as a feature that quietly persists nothing.
  for (const col of [
    'ozalit_parca_approvals', 'ozalit_parca_rejections',
    'baski_parca_preparers', 'baski_parca_approvals',
  ]) {
    assert.ok(ORDER_WRITABLE_COLUMNS.has(col), `${col} is not writable — writes would be dropped`)
    assert.ok(ORDER_JSONB_COLUMNS.has(col), `${col} is not cast to jsonb — writes would throw`)
  }
})

test("listOrders exposes the round's parça list from the sheet", { skip: !PGlite }, async () => {
  // `ozalit_parcalar` is what every client surface reads to decide whether a
  // round is split. It comes from the SHEET, not from parca_state, because rows
  // there are materialised on first action — a split round nobody has touched
  // yet has none, and that is exactly the round whose whole-order "Teslim Edin"
  // would advance past proofs that were never printed.
  //
  // Driving the real listOrders rather than a copy of its SQL: the point is
  // that the column reaches the client, and a hand-copied query would keep
  // passing after the real one was edited.
  const db = new PGlite()
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => /^\d{3}__.+\.sql$/.test(f)).sort()
  for (const f of files) {
    await db.exec(`BEGIN; ${await fs.readFile(path.join(MIGRATIONS_DIR, f), 'utf8')} ; COMMIT;`)
  }
  await db.exec(`
    INSERT INTO users (id, name, email, role) VALUES ('u1','Esra','e@e.com','satis');
    INSERT INTO projects (id, title, type, stage) VALUES ('p1','Kitap','TR','baskida');
    INSERT INTO order_requests (id, project_id, requested_by, status)
      VALUES ('split','p1','u1','matbaa_ozalit_yapiyor'),
             ('single','p1','u1','matbaa_ozalit_yapiyor'),
             ('nosheet','p1','u1','atama_bekleniyor');
    INSERT INTO demos (id, project_id, order_id, kind, attempt, payload) VALUES
      ('d1','p1','split','ozalit',1,'{"_selectedComponents":["KUTU","KITAP","KILAVUZ"]}'),
      ('d2','p1','single','ozalit',1,'{"_selectedComponents":["KAPAK"]}');
  `)

  const rows = await listOrders(db)
  const byId = Object.fromEntries(rows.map((r) => [r.row.id, r.row.ozalit_parcalar]))
  assert.deepEqual(byId.split, ['KUTU', 'KITAP', 'KILAVUZ'], 'a split round reports its parçalar')
  assert.deepEqual(byId.single, ['KAPAK'], 'a one-parça round is not split')
  assert.deepEqual(byId.nosheet, [], 'an order with no sheet yet must not break the list')

  // Three live orders on one title: `order_no` (migration 083) is the only
  // thing that tells their cards apart, so it has to reach the client.
  const nos = rows.map((r) => r.row.order_no).sort()
  assert.deepEqual(nos, [1, 2, 3])
  await db.close()
})
