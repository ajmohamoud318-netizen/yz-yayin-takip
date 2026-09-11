/**
 * A project's designer list is stored (migration 086), so a designer whose
 * only work is İç Sayfalar on "Tüm Tasarımcılar" is really on the project.
 *
 * The case from the team: a leader creates a book with three designers —
 * Ayşe on Kapak, İç Sayfalar shared by everyone. Before 086 the list was
 * rebuilt from the primary and the subtask owners, so the page designers,
 * who own no subtask row, never got the project: it wasn't in their list,
 * nobody notified them, and the designer-batches gate refused their pages.
 *
 * Three behaviours pinned here, all against real Postgres (PGlite):
 *   a. Created with all three designers → detail and list both carry all
 *      three, each is greeted, and a page designer can log pages.
 *   b. Created with no designers and staffed later through the edit
 *      dialog's two saves (PATCH primary, PUT subtasks) → same outcome,
 *      one greeting per designer.
 *   c. A designer taken off the list loses the project and can no longer
 *      log pages on the shared row.
 *
 * Drives the routes via `app.inject()` against `buildServer()`, same harness
 * as subtasks-redo-on-note.integration.test.js.
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
  console.log('[project-assignees.integration] pglite not installed — skipping')
}

const LEADER = { id: 'x-lead', name: 'Lale', email: 'x-lead@e.com', role: 'team_leader' }
const AYSE = { id: 'x-ayse', name: 'Ayşe', email: 'x-ayse@e.com', role: 'designer' }
const MEHMET = { id: 'x-mehmet', name: 'Mehmet', email: 'x-mehmet@e.com', role: 'designer' }
const ZEYNEP = { id: 'x-zeynep', name: 'Zeynep', email: 'x-zeynep@e.com', role: 'designer' }
const USERS = [LEADER, AYSE, MEHMET, ZEYNEP]

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
  { title: 'İç Sayfalar', kind: 'pages', total_pages: 32 },
]

async function createBook(app, body) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: as(LEADER),
    payload: { title: 'KEÇEMİNO ÇİFTLİK', type: 'TR', subtasks: SUBTASKS, ...body },
  })
  assert.equal(res.statusCode, 200, res.body)
  return JSON.parse(res.body).id
}

/** The edit dialog's subtask save: Kapak to Ayşe, İç Sayfalar shared. */
async function saveSubtasks(app, projectId, assignees) {
  const res = await app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/subtasks`,
    headers: as(LEADER),
    payload: {
      assignees,
      subtasks: [
        { title: 'Kapak', kind: 'check', assigned_to: AYSE.id },
        { title: 'İç Sayfalar', kind: 'pages', total_pages: 32, assigned_to: '__all__' },
      ],
    },
  })
  assert.equal(res.statusCode, 200, res.body)
}

async function detailDesignerIds(app, projectId) {
  const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}`, headers: as(LEADER) })
  assert.equal(res.statusCode, 200, res.body)
  return JSON.parse(res.body).assignees.map((a) => a.id)
}

async function listedDesignerIds(app, viewer, projectId) {
  const res = await app.inject({ method: 'GET', url: '/api/projects', headers: as(viewer) })
  assert.equal(res.statusCode, 200, res.body)
  const row = JSON.parse(res.body).find((p) => p.id === projectId)
  return (row?.assignees ?? []).map((a) => a.id)
}

async function greetedIds(db, projectId) {
  const { rows } = await db.query(
    "SELECT user_id FROM notifications WHERE project_id = $1 AND type = 'assignment' ORDER BY user_id",
    [projectId],
  )
  return rows.map((r) => r.user_id)
}

async function logPages(app, db, designer, projectId) {
  const { rows } = await db.query(
    "SELECT id FROM subtasks WHERE project_id = $1 AND kind = 'pages'",
    [projectId],
  )
  return app.inject({
    method: 'POST',
    url: `/api/subtasks/${rows[0].id}/designer-batches`,
    headers: as(designer),
    payload: { designer_id: designer.id, pages: 4 },
  })
}

const ALL_THREE = [AYSE.id, MEHMET.id, ZEYNEP.id]

// ----- a. created with every designer ---------------------------------------

test('Kapak to one designer, İç Sayfalar to "Tüm Tasarımcılar" → every picked designer is on the project', { skip: !PGlite }, async () => {
  const { db, app } = await buildApp()
  try {
    const id = await createBook(app, {
      assignees: ALL_THREE,
      subtaskAssignees: { Kapak: AYSE.id, 'İç Sayfalar': '__all__' },
    })

    assert.deepEqual(await detailDesignerIds(app, id), ALL_THREE, 'detail must list all three, in the order picked')
    assert.deepEqual(
      await listedDesignerIds(app, ZEYNEP, id), ALL_THREE,
      'the list must carry them too — it decides whose Projelerim the book lands in',
    )
    assert.deepEqual(await greetedIds(db, id), [...ALL_THREE].sort(), 'each designer gets the new-project notification')

    const logged = await logPages(app, db, ZEYNEP, id)
    assert.ok(logged.statusCode < 300, `a page-only designer must be able to log pages: ${logged.body}`)
  } finally {
    await closeAll(db, app)
  }
})

// ----- b. created empty, staffed later ---------------------------------------

test('a project created without designers and staffed later reaches every designer, greeted once each', { skip: !PGlite }, async () => {
  const { db, app } = await buildApp()
  try {
    const id = await createBook(app, { assignees: [] })
    assert.deepEqual(await detailDesignerIds(app, id), [])
    assert.deepEqual(await greetedIds(db, id), [], 'nobody to greet yet')

    // The edit dialog's save: PATCH the primary, then PUT the subtask list
    // together with the full designer list.
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      headers: as(LEADER),
      payload: { assigned_to: AYSE.id },
    })
    assert.equal(patch.statusCode, 200, patch.body)
    await saveSubtasks(app, id, ALL_THREE)

    assert.deepEqual(await detailDesignerIds(app, id), ALL_THREE)
    assert.deepEqual(await listedDesignerIds(app, MEHMET, id), ALL_THREE)
    assert.deepEqual(
      await greetedIds(db, id), [...ALL_THREE].sort(),
      'one greeting each — the primary from the PATCH, the other two from the PUT',
    )

    const logged = await logPages(app, db, MEHMET, id)
    assert.ok(logged.statusCode < 300, `a page-only designer must be able to log pages: ${logged.body}`)
  } finally {
    await closeAll(db, app)
  }
})

// ----- c. taken off the list -------------------------------------------------

test('taking a designer off the list takes the project away from them', { skip: !PGlite }, async () => {
  const { db, app } = await buildApp()
  try {
    const id = await createBook(app, {
      assignees: ALL_THREE,
      subtaskAssignees: { Kapak: AYSE.id, 'İç Sayfalar': '__all__' },
    })
    await saveSubtasks(app, id, [AYSE.id, MEHMET.id])

    assert.deepEqual(await detailDesignerIds(app, id), [AYSE.id, MEHMET.id])
    assert.deepEqual(await listedDesignerIds(app, ZEYNEP, id), [AYSE.id, MEHMET.id])

    const logged = await logPages(app, db, ZEYNEP, id)
    assert.equal(logged.statusCode, 400, `a removed designer must not log on the shared row: ${logged.body}`)
  } finally {
    await closeAll(db, app)
  }
})
