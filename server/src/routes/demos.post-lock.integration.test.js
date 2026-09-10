/**
 * POST /api/demos — per-parça content lock guard, integration-tested.
 *
 * The guard lives in `routes/demos.js` (the block gated on
 * `request.user.role !== 'printer' && roundLive && locked.length > 0`).
 * It refuses a save that rewrites a parça the matbaa has already started
 * (rows in `parca_state` with `started_at` set, `fix_pending` false) —
 * the same shape the dedicated `/projects/:id/demo-edit-notify` and
 * `/order-requests/:id/ozalit-edit-notify` endpoints already enforce, but
 * those endpoints do their OWN insert into `demos` and never call this
 * route, so a save that comes through the SPA's mirror-to-server
 * `SpecFormDialog#persistServerSnapshot` had no server-side check at all.
 *
 * Four behaviours are pinned here against real Postgres (PGlite):
 *   a. Designer silently rewrites a locked parça → 400.
 *   b. Designer rewrites only an UNLOCKED parça in the same round → 200.
 *   c. Printer saves a snapshot while the round is live → not 400 (the
 *      role check exempts the printer; their own teslim writes are
 *      performed with `started_at` set by definition).
 *   d. Save on a NOT-live round (project moved off demo_teslim) → 200
 *      even on a locked parça (the `roundLive` gate prevents the
 *      per-parça guard from firing).
 *
 * Drives the route via `app.inject()` against `buildServer()` so the real
 * schema validation, `attachUser`, error handler, `withTx`, and the route's
 * own `withTx` body all run — the same realistic path the SPA hits.
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
  console.log('[demos.post-lock.integration] pglite not installed — skipping')
}

const DESIGNER = { id: 'u-d', name: 'Defne', email: 'd@e.com', role: 'designer' }
const PRINTER  = { id: 'u-p', name: 'Polat', email: 'p@e.com', role: 'printer' }
const LEADER   = { id: 'u-l', name: 'Lale', email: 'l@e.com', role: 'team_leader' }
const SATIS    = { id: 'u-s', name: 'Sina', email: 's@e.com', role: 'satis' }

// Parçalar are name-keyed strings throughout this codebase. The matbaa queue
// shows them verbatim; `_selectedComponents` is what the leader/designer
// ticked. Default name + " KUTU" / " KILAVUZ" is exactly what the SPA's
// `defaultParcaNames` ships when the Ürün Bilgileri form has nothing
// specific (sanitiseParcalar → "KUTU" / "KILAVUZ" suffix).
const PARCALAR = [
  'KEÇEMİNO ÇİFTLİK',
  'KEÇEMİNO ÇİFTLİK KUTU',
  'KEÇEMİNO ÇİFTLİK KILAVUZ',
]
const LOCKED_PARCA = 'KEÇEMİNO ÇİFTLİK KUTU'

/**
 * A pg.Pool-shaped object around PGlite so `db/pool.js`'s `withTx`
 * (which calls `getPool().connect()` and then issues raw
 * `BEGIN/COMMIT/ROLLBACK` on the returned client) runs unchanged.
 *
 * PGlite's `.query()` honours raw `BEGIN`/`COMMIT`/`ROLLBACK` statements
 * (verified locally: inside-BEGIN statements are isolated, COMMIT makes
 * them visible, ROLLBACK throws them away), so no `.transaction(...)`
 * wrapper is required. The returned `client` carries the dummy `release`
 * `withTx` calls and the `afterCommit` hook it sets.
 */
function fakePool(db) {
  // A fresh `client` wrapper per transaction — `withTx` calls
  // `release()` at the end and the next transaction needs the hooks list
  // empty. Matches the lifecycle `pg.Pool#connect()` gives each request.
  const makeClient = () => {
    const hooks = []
    const client = {
      query: (...args) => db.query(...args),
      // `release()` is a noop here: PGlite has no connection pool, so
      // there is nothing to put back. The production pg.Pool requires
      // it for the same reason a check-out/check-in flow exists; we
      // mock only the contract, not the resource.
      release: () => {},
      afterCommit: (cb) => { if (typeof cb === 'function') hooks.push(cb) },
    }
    return client
  }
  return {
    query: (...args) => db.query(...args),
    connect: async () => makeClient(),
    // `end()` is called by `closePool()` in db/pool.js. Tests don't
    // route through closePool; they `db.close()` PGlite themselves,
    // so this stays a noop.
    end: async () => {},
  }
}

/**
 * Seed a three-parça project sitting at `demo_teslim` with the matbaa
 * mid-production on one parça. Builds a fastify app wired to this db.
 */
async function buildApp({ stage = 'demo_teslim' } = {}) {
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
       ($1,$2,$3,'designer'), ($4,$5,$6,'printer'),
       ($7,$8,$9,'team_leader'), ($10,$11,$12,'satis')`,
    [
      DESIGNER.id, DESIGNER.name, DESIGNER.email,
      PRINTER.id,  PRINTER.name,  PRINTER.email,
      LEADER.id,   LEADER.name,   LEADER.email,
      SATIS.id,    SATIS.name,    SATIS.email,
    ],
  )
  // The migration seeds a default team leader; deactivate it so multi-party
  // gates in unrelated code paths don't surprise us — not strictly needed
  // for this leg (the per-parça guard doesn't read active leaders), but
  // it matches the project's own integration-test conventions.
  await db.query(
    'UPDATE users SET is_active = FALSE WHERE id <> ALL($1::text[])',
    [[DESIGNER.id, PRINTER.id, LEADER.id, SATIS.id]],
  )
  await db.query(
    `INSERT INTO projects (id, title, type, stage, demo_attempt)
     VALUES ('p1','KEÇEMİNO ÇİFTLİK','TR',$1,1)`,
    [stage],
  )
  // The latest snapshot the SPA's mirror-to-server call carries an
  // `_selectedComponents` array the guard needs to compare against. Its
  // rows are what `changedParcaBlocks` will fingerprint — three real
  // rows, one per parça, so each save below changes something concrete
  // and we can also confirm what "an unlocked parça was edited" means
  // without it accidentally looking like an addition/removal.
  await db.query(
    `INSERT INTO demos (id, project_id, kind, attempt, payload)
     VALUES ('d-baseline','p1','demo',1,$1::jsonb)`,
    [JSON.stringify({
      _selectedComponents: PARCALAR.map((parca) => ({
        component: parca,
        rows: [
          { id: 'r-' + parca, label: 'Ölçü', value: 'A4' },
        ],
      })),
    })],
  )
  // One parça "started" by the matbaa: the only one the guard should
  // protect on a save to this round. The other two stay unstarted, so
  // they are free to edit.
  await db.query(
    `INSERT INTO parca_state (project_id, parca, gate, state, owner_role, route,
                              attempt, started_at, fix_pending)
     VALUES ('p1',$1,'demo','in_round','printer','physical',1,NOW(),FALSE)`,
    [LOCKED_PARCA],
  )

  // Swap the global pool for our PGlite-backed fake so the route's
  // `withTx` writes here.
  __setPoolForTests(fakePool(db))

  const app = await buildServer()
  return { db, app }
}

async function closeAll(db, app) {
  // Reset the pool swap so we don't leak the closed PGlite into later
  // tests in the same process.
  __setPoolForTests(null)
  if (app) await app.close()
  if (db) await db.close()
}

const postDemos = (app, user, body) =>
  app.inject({
    method: 'POST',
    url: '/api/demos',
    headers: { 'x-user-id': user.id },
    payload: body,
  })

const demoCount = async (db) =>
  (await db.query("SELECT count(*)::int AS n FROM demos WHERE project_id = 'p1'")).rows[0].n

// ----- a. Designer silently rewrites the locked parça → 400 -----------------

test('designer rewrites a parça the matbaa has started → 400 with the expected message', { skip: !PGlite }, async () => {
  const { db, app } = await buildApp()
  try {
    const res = await postDemos(app, DESIGNER, {
      project_id: 'p1',
      kind: 'demo',
      // silent=true keeps the "Demo formu gönderildi" history row out of
      // the assertion — the test cares about the guard and the snapshot,
      // not the timeline noise.
      silent: true,
      payload: {
        _selectedComponents: PARCALAR.map((parca) => ({
          component: parca,
          // LOCKED_PARCA's row is what changes — the unlocked rows ride
          // along unchanged so the diff is clearly a content rewrite, not
          // an add/remove.
          rows: [
            {
              id: 'r-' + parca,
              label: 'Ölçü',
              value: parca === LOCKED_PARCA ? 'A5' : 'A4',
            },
          ],
        })),
      },
    })

    assert.equal(res.statusCode, 400, res.body)
    const body = JSON.parse(res.body)
    // Exact wording matters: the client renders this toast verbatim.
    assert.match(body.error, /Matbaa şu parçalara başladı/)
    assert.match(body.error, /KEÇEMİNO ÇİFTLİK KUTU/)
    assert.equal(await demoCount(db), 1, 'no new snapshot must have been written')
  } finally {
    await closeAll(db, app)
  }
})

// ----- b. Designer rewrites ONLY an unlocked parça in the same round → 200 -

test('designer rewrites only an unlocked parça → 200 (the guard does not over-fire)', { skip: !PGlite }, async () => {
  const { db, app } = await buildApp()
  try {
    const res = await postDemos(app, DESIGNER, {
      project_id: 'p1',
      kind: 'demo',
      silent: true,
      payload: {
        _selectedComponents: PARCALAR.map((parca) => ({
          component: parca,
          rows: [
            {
              id: 'r-' + parca,
              label: 'Ölçü',
              // KILAVUZ (unlocked) changes; KUTU (locked) stays at A4
              // verbatim, matching the baseline exactly.
              value: parca === 'KEÇEMİNO ÇİFTLİK KILAVUZ' ? 'B5' : 'A4',
            },
          ],
        })),
      },
    })

    assert.equal(res.statusCode, 200, res.body)
    assert.equal(await demoCount(db), 2, 'the unlocked-parça save must land')
  } finally {
    await closeAll(db, app)
  }
})

// ----- c. Printer's own save while the round is live → NOT 400 --------------

test('printer saves a snapshot while the round is live → 200 (role check exempts the printer)', { skip: !PGlite }, async () => {
  // Why this must hold: the printer's own `handleAdvance` writes the
  // teslim stamp while `started_at` is set (by definition — only a
  // parça the matbaa has actually started gets delivered). The per-parça
  // guard is gated `request.user.role !== 'printer'`, so the printer's
  // own save must NOT be refused for touching the locked parça's rows.
  const { db, app } = await buildApp()
  try {
    const res = await postDemos(app, PRINTER, {
      project_id: 'p1',
      kind: 'demo',
      silent: true,
      payload: {
        _selectedComponents: PARCALAR.map((parca) => ({
          component: parca,
          rows: [
            {
              id: 'r-' + parca,
              label: 'Ölçü',
              value: parca === LOCKED_PARCA ? 'A5' : 'A4',
            },
          ],
        })),
      },
    })

    assert.notEqual(res.statusCode, 400, `printer must not be 400'd; got ${res.statusCode}: ${res.body}`)
    assert.equal(res.statusCode, 200, res.body)
    assert.equal(await demoCount(db), 2, 'the printer save must land')
  } finally {
    await closeAll(db, app)
  }
})

// ----- d. NOT-live round → guard does not fire on a locked parça -----------

test('save on a not-live round (project moved off demo_teslim) → 200 even on a locked parça', { skip: !PGlite }, async () => {
  // `roundLive` is the gate above the per-parça check. When the project
  // has moved off `demo_teslim` (e.g. to `demo_onay`), `roundLive` is
  // false and the per-parça guard is never evaluated — so even a save
  // that rewrites the locked parça's content must land. This pins the
  // scoping to "live round" and guards against an accidental widening
  // that would refuse legitimate post-delivery sheet corrections.
  const { db, app } = await buildApp({ stage: 'demo_onay' })
  try {
    const res = await postDemos(app, DESIGNER, {
      project_id: 'p1',
      kind: 'demo',
      silent: true,
      payload: {
        _selectedComponents: PARCALAR.map((parca) => ({
          component: parca,
          rows: [
            {
              id: 'r-' + parca,
              label: 'Ölçü',
              value: parca === LOCKED_PARCA ? 'A5' : 'A4',
            },
          ],
        })),
      },
    })

    assert.equal(res.statusCode, 200, res.body)
    assert.equal(await demoCount(db), 2, 'the save must land on a non-live round')
  } finally {
    await closeAll(db, app)
  }
})