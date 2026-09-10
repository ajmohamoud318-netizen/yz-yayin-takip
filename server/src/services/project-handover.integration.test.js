/**
 * The project's OWN teslim leg, driven through a real database.
 *
 * Confirming a handover used to trust the row blindly: `confirmProjectHandoverReceipt`
 * set `stage = 'satista'` with no check that the project was still where the
 * handover was raised from. A leader rejecting the whole round back to tasarım
 * for a redesign — after the matbaa had already raised a handover on the
 * now-superseded batch — left that handover 'pending'; satış confirming it
 * later jumped the project straight to `satista`, skipping the entire
 * redesign and re-approval the reject demanded.
 *
 * Two fixes, asserted here against real Postgres (PGlite):
 *   1. The confirm route re-checks the project's CURRENT stage before writing
 *      `satista`, and refuses (409) if it has moved on.
 *   2. `rejectProject`'s `after` hook deletes a stale pending handover the
 *      moment the reject leaves the handover-eligible stage — otherwise the
 *      row survives with nothing able to touch it (no cancel endpoint), and
 *      the unique partial index (one pending row per project) would then
 *      block the matbaa from ever raising a legitimate one once the redo
 *      reaches baskida/gümrük again.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nanoid } from 'nanoid'

import { confirmProjectHandoverReceipt } from '../routes/handovers.js'
import { rejectProject } from './project-service/transitions.js'

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations',
)

let PGlite = null
try {
  ({ PGlite } = await import('@electric-sql/pglite'))
} catch {
  // eslint-disable-next-line no-console
  console.log('[project-handover.integration] pglite not installed — skipping')
}

const SATIS = { id: 'u-esra', role: 'satis', name: 'Esra' }
const PRINTER = { id: 'u-oktay', role: 'printer', name: 'Oktay' }
const LEADER = { id: 'u-ayse', role: 'team_leader', name: 'Ayşenur' }

async function seeded({ stage = 'baskida', type = 'TR' } = {}) {
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
  // Every ACTIVE leader is a required signature on other per-parça gates —
  // irrelevant to this leg, but retiring the migration-seeded leader keeps
  // this fixture identical in shape to its siblings.
  await db.query(
    'UPDATE users SET is_active = FALSE WHERE id <> ALL($1::text[])',
    [[SATIS.id, PRINTER.id, LEADER.id]],
  )
  await db.query(
    'INSERT INTO projects (id, title, type, stage) VALUES ($1,$2,$3,$4)',
    ['p1', 'KEÇEMİNO ÇİFTLİK', type, stage],
  )
  const handoverId = `h-${nanoid(16)}`
  await db.query(
    `INSERT INTO handovers (id, project_id, order_id, status, from_stage, raised_by)
     VALUES ($1,'p1',NULL,'pending',$2,$3)`,
    [handoverId, stage, PRINTER.id],
  )
  return { db, handoverId }
}

const projectStage = async (db) =>
  (await db.query("SELECT stage FROM projects WHERE id = 'p1'")).rows[0].stage
const pendingHandovers = async (db) =>
  (await db.query("SELECT id FROM handovers WHERE project_id = 'p1' AND status = 'pending'")).rows

function confirm(db, handoverId) {
  // The route locks + flips the handover row itself before calling this —
  // reproduce just enough of that here (the row content this function reads).
  return confirmProjectHandoverReceipt(
    db,
    { user: SATIS },
    { project_id: 'p1', from_stage: 'baskida', raised_by: PRINTER.id },
    { id: handoverId },
  )
}

test('confirming a live handover still moves the project to satista', { skip: !PGlite }, async () => {
  const { db, handoverId } = await seeded()
  await confirm(db, handoverId)
  assert.equal(await projectStage(db), 'satista')
  await db.close()
})

test('confirming a handover the project has moved past is refused, not silently honoured', { skip: !PGlite }, async () => {
  const { db, handoverId } = await seeded()
  // The leader rejected the whole round for a redesign AFTER the matbaa
  // raised the handover — the project is no longer at baskida.
  await db.query("UPDATE projects SET stage = 'tasarim' WHERE id = 'p1'")
  await assert.rejects(
    () => confirm(db, handoverId),
    /bu arada başka bir aşamaya geçti/,
  )
  assert.equal(await projectStage(db), 'tasarim', 'must not have jumped to satista')
  await db.close()
})

test('a whole-round reject from baskida deletes the stale pending handover', { skip: !PGlite }, async () => {
  const { db } = await seeded()
  assert.equal((await pendingHandovers(db)).length, 1, 'sanity: the handover is there to begin with')

  await rejectProject('p1', LEADER, {
    stage: 'baskida', reason: 'Baskı hatalı', rejectTarget: 'designer', revizeIds: [],
  }, db)

  assert.equal(await projectStage(db), 'tasarim')
  assert.equal(
    (await pendingHandovers(db)).length, 0,
    'the stale row must be gone — nothing else can ever clear it, and it would' +
    ' otherwise block the matbaa from raising a real one once baskida is reached again',
  )
  await db.close()
})

test('a reject that does NOT leave the handover stage leaves the row alone', { skip: !PGlite }, async () => {
  // Baskı Onayı (not baskida) — rejecting here also lands on tasarim, but the
  // project was never AT the handover-eligible stage, so there is nothing
  // stale to clean up. Pins the guard to the stage the reject actually left,
  // not just "any reject that ends at tasarim".
  const { db, handoverId } = await seeded({ stage: 'baski_onay' })
  // A handover cannot really be pending at baski_onay in practice (it is only
  // ever raised from baskida/gümrük) — inserted directly here purely to prove
  // the cleanup is scoped to leaving the RIGHT stage, not triggered by every
  // reject-to-tasarim regardless of where it started.
  await rejectProject('p1', LEADER, {
    stage: 'baski_onay', reason: 'Renkler yanlış', rejectTarget: 'designer', revizeIds: [],
  }, db)

  assert.equal(await projectStage(db), 'tasarim')
  assert.equal(
    (await pendingHandovers(db)).length, 1,
    'unrelated to this reject — must survive untouched',
  )
  const [row] = await pendingHandovers(db)
  assert.equal(row.id, handoverId)
  await db.close()
})

test('a partial (per-parça) reject never touches the handover — nothing moved', { skip: !PGlite }, async () => {
  const { db } = await seeded({ stage: 'ozalit_onay' })
  await db.query("UPDATE projects SET ozalit_received = true WHERE id = 'p1'")
  await rejectProject('p1', LEADER, {
    stage: 'ozalit_onay', reason: 'x', rejectTarget: 'designer', revizeIds: [], parcalar: ['KUTU'],
  }, db)

  assert.equal(await projectStage(db), 'ozalit_onay', 'a per-parça reject does not move the project')
  assert.equal(
    (await pendingHandovers(db)).length, 1,
    'the project never left the handover stage (it was never at it) — untouched either way',
  )
  await db.close()
})
