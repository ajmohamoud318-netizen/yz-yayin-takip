/**
 * "Henüz atanmadı" — a subtask the team hasn't given to anyone yet.
 *
 * An empty subtask pick hands the row to the project primary, on create and on
 * edit. That default stays, but it left the team leader no way to say "we
 * haven't decided who does this": every row landed on somebody. The SPA sends
 * "__none__" for that pick and both paths store an ownerless row — the same
 * NULL `assigned_to` İç Sayfalar uses for "Tüm Tasarımcılar"; the kind tells
 * them apart.
 *
 * Drives the routes via `app.inject()` against `buildServer()` on PGlite, same
 * harness as project-assignees.integration.test.js.
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
  console.log('[subtask-unassigned.integration] pglite not installed — skipping')
}

const LEADER = { id: 'y-lead', name: 'Lale', email: 'y-lead@e.com', role: 'team_leader' }
const AYSE = { id: 'y-ayse', name: 'Ayşe', email: 'y-ayse@e.com', role: 'designer' }
const MEHMET = { id: 'y-mehmet', name: 'Mehmet', email: 'y-mehmet@e.com', role: 'designer' }
const USERS = [LEADER, AYSE, MEHMET]

/** pg.Pool-shaped wrapper around PGlite — see subtasks-redo-on-note.integration. */
function fakePool(db) {
  const makeClient = () => ({
    query: (...args) => db.query(...args),
    release: () => {},
    afterCommit: () => {},
  })
  return {
    query: (...args) => db.query(...args),
    connect: async () => makeClient(),
    end: async () => {},
  }
}

async function buildApp() {
  const db = new PGlite()
  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((f) => /^\d{3}__.+\.sql$/.test(f))
    .sort()
  for (const f of files) {
    // eslint-disable-next-line no-await-in-loop
    await db.exec(`BEGIN; ${await fs.readFile(path.join(MIGRATIONS_DIR, f), 'utf8')} ; COMMIT;`)
  }
  for (const u of USERS) {
    // eslint-disable-next-line no-await-in-loop
    await db.query(
      'INSERT INTO users (id, name, email, role) VALUES ($1,$2,$3,$4)',
      [u.id, u.name, u.email, u.role],
    )
  }
  // Keep any user a migration seeded out of the notification fan-out.
  await db.query(
    'UPDATE users SET is_active = FALSE WHERE id <> ALL($1::text[])',
    [USERS.map((u) => u.id)],
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

const as = (user) => ({ 'x-user-id': user.id })

const SUBTASKS = [
  { title: 'Kapak', kind: 'check' },
  { title: 'Kutu', kind: 'check' },
  { title: 'Kılavuz', kind: 'check' },
]

/** A two-designer book; Ayşe, picked first, is the primary. */
async function createBook(app, subtaskAssignees) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: as(LEADER),
    payload: {
      title: 'KEÇEMİNO ÇİFTLİK',
      type: 'TR',
      assignees: [AYSE.id, MEHMET.id],
      subtasks: SUBTASKS,
      subtaskAssignees,
    },
  })
  assert.equal(res.statusCode, 200, res.body)
  return JSON.parse(res.body).id
}

/** The edit dialog's subtask save. A title missing from `picks` was left empty. */
async function saveSubtasks(app, projectId, picks) {
  const res = await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/subtasks`,
    headers: as(LEADER),
    payload: {
      assignees: [AYSE.id, MEHMET.id],
      subtasks: SUBTASKS.map((s) => ({ ...s, assigned_to: picks[s.title] ?? null })),
    },
  })
  assert.equal(res.statusCode, 200, res.body)
}

async function owners(db, projectId) {
  const { rows } = await db.query(
    'SELECT title, assigned_to FROM subtasks WHERE project_id = $1 ORDER BY position',
    [projectId],
  )
  return Object.fromEntries(rows.map((r) => [r.title, r.assigned_to]))
}

test('create: "Henüz atanmadı" leaves the row without an owner, an empty pick still goes to the primary', { skip: !PGlite }, async () => {
  const { db, app } = await buildApp()
  try {
    const id = await createBook(app, { Kapak: MEHMET.id, Kutu: '__none__' })

    assert.deepEqual(await owners(db, id), { Kapak: MEHMET.id, Kutu: null, Kılavuz: AYSE.id })
  } finally {
    await closeAll(db, app)
  }
})

test('edit: "Henüz atanmadı" takes a row off its designer without handing it to the primary, and it can be given out later', { skip: !PGlite }, async () => {
  const { db, app } = await buildApp()
  try {
    const id = await createBook(app, { Kapak: MEHMET.id })
    assert.deepEqual(await owners(db, id), { Kapak: MEHMET.id, Kutu: AYSE.id, Kılavuz: AYSE.id })

    await saveSubtasks(app, id, { Kapak: MEHMET.id, Kutu: '__none__' })
    assert.deepEqual(
      await owners(db, id), { Kapak: MEHMET.id, Kutu: null, Kılavuz: AYSE.id },
      'Kutu has no owner; Kılavuz, left empty, stays on the primary',
    )

    // The team decides: Kutu goes to Mehmet.
    await saveSubtasks(app, id, { Kapak: MEHMET.id, Kutu: MEHMET.id })
    assert.deepEqual(await owners(db, id), { Kapak: MEHMET.id, Kutu: MEHMET.id, Kılavuz: AYSE.id })
  } finally {
    await closeAll(db, app)
  }
})
