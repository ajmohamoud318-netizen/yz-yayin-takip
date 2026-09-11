/**
 * POST /api/subtasks/:id/updates — the designer's "Yeniden Çalıştım" note
 * piggybacks the handover-redo ack (migration 085).
 *
 * The endpoint has been the designer's informal "I touched this again"
 * timeline-note path since before migration 085. After 085 the same
 * button also clears the `needs_redo` flag the leader stamped during
 * reassignment — so a single click both drops a timeline note AND
 * acks the redo, instead of forcing two buttons on the row.
 *
 * Five behaviours pinned here, all against real Postgres (PGlite):
 *   a. Assigned designer notes → 200 with redoCleared=true, flag
 *      flips to FALSE, is_done stays TRUE, exactly one
 *      `subtask_note` row + one `subtask_redo_acked` row are
 *      written (two distinct history rows for the two distinct
 *      events — the fold bucket in client/lib/project-history.js
 *      collapses them in the timeline but they must remain
 *      separate rows).
 *   b. Assigned designer notes on a row without needs_redo →
 *      200 with redoCleared=false, flag stays FALSE, only the
 *      `subtask_note` row is written.
 *   c. A different designer (not the row's assigned_to) notes a
 *      redo-flagged row → 200 with redoCleared=false, flag stays
 *      TRUE, no `subtask_redo_acked` row. The note still lands —
 *      the owner gate only governs the flag-clear, not the
 *      timeline-note.
 *   d. Team leader notes a redo-flagged row → 200 with
 *      redoCleared=false, flag stays TRUE, no
 *      `subtask_redo_acked` row. Same as (c) — the leader who
 *      set the flag can't clear it themselves; the assignee must
 *      ack.
 *   e. Subtask id doesn't exist → 404 (unchanged from the
 *      pre-085 behaviour).
 *
 * Drives the route via `app.inject()` against `buildServer()` so the
 * real schema validation, `attachUser`, error handler, `withTx`, and
 * the route's own `withTx` body all run — the same realistic path
 * the SPA hits.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildServer } from '../index.js'
import { __setPoolForTests } from '../db/pool.js'

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations',
)

let PGlite = null
try {
  ({ PGlite } = await import('@electric-sql/pglite'))
} catch {
  // eslint-disable-next-line no-console
  console.log('[subtasks-redo-on-note.integration] pglite not installed — skipping')
}

const NEW_OWNER  = { id: 'u-new', name: 'Neva',   email: 'n@e.com', role: 'designer' }
const PREV_OWNER = { id: 'u-prev', name: 'Polat', email: 'p@e.com', role: 'designer' }
const LEADER     = { id: 'u-l',    name: 'Lale',   email: 'l@e.com', role: 'team_leader' }
const OTHER_DESIGNER = { id: 'u-oth', name: 'Oya', email: 'o@e.com', role: 'designer' }

const PROJECT_ID = 'p-redo'
const SUBTASK_ID = 's-kapak'

/**
 * pg.Pool-shaped wrapper around PGlite. Identical to the demos
 * integration test's pattern — see that file's header comment for
 * the PGlite-vs-pg.Pool compatibility notes.
 */
function fakePool(db) {
  const makeClient = () => {
    const hooks = []
    const client = {
      query: (...args) => db.query(...args),
      release: () => {},
      afterCommit: (cb) => { if (typeof cb === 'function') hooks.push(cb) },
    }
    return client
  }
  return {
    query: (...args) => db.query(...args),
    connect: async () => makeClient(),
    end: async () => {},
  }
}

/**
 * Seed: one redo-flagged row whose assigned_to is NEW_OWNER, the
 * one whose note is expected to clear the flag. The row sits at
 * is_done=TRUE — that's the whole point of migration 085: the
 * previous owner's credit survives.
 */
async function buildApp({ redoFlagged = true } = {}) {
  const db = new PGlite()
  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((f) => /^\d{3}__.+\.sql$/.test(f))
    .sort()
  for (const f of files) {
    // eslint-disable-next-line no-await-in-loop
    await db.exec(`BEGIN; ${await fs.readFile(path.join(MIGRATIONS_DIR, f), 'utf8')} ; COMMIT;`)
  }
  await db.query(
    `INSERT INTO users (id, name, email, role) VALUES
       ($1,$2,$3,'designer'), ($4,$5,$6,'designer'),
       ($7,$8,$9,'designer'), ($10,$11,$12,'team_leader')`,
    [
      NEW_OWNER.id, NEW_OWNER.name, NEW_OWNER.email,
      PREV_OWNER.id, PREV_OWNER.name, PREV_OWNER.email,
      OTHER_DESIGNER.id, OTHER_DESIGNER.name, OTHER_DESIGNER.email,
      LEADER.id, LEADER.name, LEADER.email,
    ],
  )
  await db.query(
    'UPDATE users SET is_active = FALSE WHERE id <> ALL($1::text[])',
    [[NEW_OWNER.id, PREV_OWNER.id, OTHER_DESIGNER.id, LEADER.id]],
  )
  await db.query(
    `INSERT INTO projects (id, title, type, stage)
     VALUES ($1,'KEÇEMİNO ÇİFTLİK','TR','tasarim')`,
    [PROJECT_ID],
  )
  await db.query(
    `INSERT INTO subtasks (id, project_id, title, kind, position, is_done, done_at, needs_redo, assigned_to)
     VALUES ($1,$2,'KAPAK','check',1,TRUE,NOW(),$3,$4)`,
    [SUBTASK_ID, PROJECT_ID, redoFlagged, NEW_OWNER.id],
  )

  __setPoolForTests(fakePool(db))
  const app = await buildServer()
  return { db, app }
}

async function closeAll(db, app) {
  __setPoolForTests(null)
  if (app) await app.close()
  if (db) await db.close()
}

const postNote = (app, user, id, note = 'Yeniden çalışıldı.') =>
  app.inject({
    method: 'POST',
    url: `/api/subtasks/${id}/updates`,
    headers: { 'x-user-id': user.id },
    payload: { note },
  })

const needsRedo = async (db) =>
  (await db.query('SELECT needs_redo FROM subtasks WHERE id = $1', [SUBTASK_ID])).rows[0].needs_redo
const isDone = async (db) =>
  (await db.query('SELECT is_done FROM subtasks WHERE id = $1', [SUBTASK_ID])).rows[0].is_done
const eventCount = async (db, event) =>
  (await db.query(
    'SELECT count(*)::int AS n FROM stage_history WHERE project_id = $1 AND event = $2',
    [PROJECT_ID, event],
  )).rows[0].n

// ----- a. assigned designer's note clears the flag --------------------------

test('assigned designer notes a redo-flagged row → flag clears, is_done survives, two history rows written', { skip: !PGlite }, async () => {
  const { db, app } = await buildApp({ redoFlagged: true })
  try {
    const res = await postNote(app, NEW_OWNER, SUBTASK_ID)
    assert.equal(res.statusCode, 200, res.body)
    const body = JSON.parse(res.body)
    // Response surface — the client toasts off this.
    assert.equal(body.redoCleared, true, 'response must report redoCleared=true')

    // The flag flips, the previous owner's is_done credit survives.
    assert.equal(await needsRedo(db), false, 'needs_redo must flip to FALSE')
    assert.equal(await isDone(db), true, 'is_done must stay TRUE — the previous designer\'s credit survives')

    // Two distinct history rows: one for the note, one for the redo ack.
    // The fold bucket in project-history.js collapses them in the UI but
    // they must remain separate events so the timeline can answer "was
    // this row explicitly re-acked or just touched again?".
    assert.equal(await eventCount(db, 'subtask_note'), 1)
    assert.equal(await eventCount(db, 'subtask_redo_acked'), 1)
  } finally {
    await closeAll(db, app)
  }
})

// ----- b. assigned designer notes a row without the flag -------------------

test('assigned designer notes a row WITHOUT needs_redo → redoCleared=false, only the note row is written', { skip: !PGlite }, async () => {
  const { db, app } = await buildApp({ redoFlagged: false })
  try {
    const res = await postNote(app, NEW_OWNER, SUBTASK_ID)
    assert.equal(res.statusCode, 200, res.body)
    const body = JSON.parse(res.body)
    assert.equal(body.redoCleared, false, 'no flag to clear → redoCleared must be false')

    assert.equal(await needsRedo(db), false, 'flag stays FALSE (was never set)')
    assert.equal(await eventCount(db, 'subtask_note'), 1)
    assert.equal(await eventCount(db, 'subtask_redo_acked'), 0, 'no redo-ack row when flag was never set')
  } finally {
    await closeAll(db, app)
  }
})

// ----- c. a non-owner designer's note must NOT clear the flag --------------

test('non-owner designer notes a redo-flagged row → flag stays TRUE, no redo-ack row', { skip: !PGlite }, async () => {
  const { db, app } = await buildApp({ redoFlagged: true })
  try {
    const res = await postNote(app, OTHER_DESIGNER, SUBTASK_ID)
    assert.equal(res.statusCode, 200, res.body)
    const body = JSON.parse(res.body)
    // The note itself still lands — only the flag-clear is owner-gated.
    assert.equal(body.redoCleared, false)
    assert.equal(await needsRedo(db), true, 'a non-owner must NOT be able to clear the flag')
    assert.equal(await eventCount(db, 'subtask_note'), 1, 'the note itself still lands')
    assert.equal(await eventCount(db, 'subtask_redo_acked'), 0)
  } finally {
    await closeAll(db, app)
  }
})

// ----- d. team leader's note must NOT clear the flag -----------------------

test('team leader notes a redo-flagged row → flag stays TRUE, no redo-ack row', { skip: !PGlite }, async () => {
  // This is the key invariant: the leader is the one who STAMPED the
  // flag during reassignment — letting the same leader clear it via a
  // note click would strip the new owner of the explicit ack step
  // the flag exists to enforce.
  const { db, app } = await buildApp({ redoFlagged: true })
  try {
    const res = await postNote(app, LEADER, SUBTASK_ID)
    assert.equal(res.statusCode, 200, res.body)
    const body = JSON.parse(res.body)
    assert.equal(body.redoCleared, false)
    assert.equal(await needsRedo(db), true, 'the leader must NOT be able to clear their own flag')
    assert.equal(await eventCount(db, 'subtask_note'), 1)
    assert.equal(await eventCount(db, 'subtask_redo_acked'), 0)
  } finally {
    await closeAll(db, app)
  }
})

// ----- e. unknown subtask id → 404 (pre-085 behaviour preserved) ------------

test('unknown subtask id → 404', { skip: !PGlite }, async () => {
  const { db, app } = await buildApp()
  try {
    const res = await postNote(app, NEW_OWNER, 's-does-not-exist')
    assert.equal(res.statusCode, 404, res.body)
  } finally {
    await closeAll(db, app)
  }
})
