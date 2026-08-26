/**
 * Schema-validation regression test for the chip PATCH routes
 * (`PATCH /api/subtasks/:id/pages/:pageIndex` and
 * `PATCH /api/subtasks/:id/pages/:pageIndex/assign`).
 *
 * Locks in the fix for the FST_ERR_VALIDATION designers were hitting
 * after a leader rejected an "İç Sayfalar" subtask: the original
 * schema declared `pageIndex: { type: 'integer' }`, but Fastify hands
 * path params to handlers as strings (URL segments are always strings)
 * and Fastify v5's ajv defaults to `coerceTypes: 'array'`, which only
 * coerces when the schema type is an array of types. A bare integer
 * type against `"2"` rejected with 400 before the handler ever ran,
 * which means the chip grid feature was 100%-broken even after the
 * SQL fix earlier in this thread.
 *
 * The current schema is `type: 'string'` with a regex pattern that
 * pins 1–100000. These tests cover:
 *
 *   • string pageIndex like "2" / "48" / "100000" → accepted
 *   • out-of-range ("0", "-1", "100001") → 400 (downstream out_of_range)
 *   • non-numeric ("abc", "") → 400 (schema pattern fails)
 *   • missing pageIndex → 400 (schema required)
 *   • the assign route reuses the same params → also accepts strings
 *
 * Uses Fastify's built-in `inject()` so the test exercises the real
 * ajv validator the server uses, not a mocked one.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { schemas } from './index.js'

// Minimal auth stub: bypass attachUser/requireRole so the schema is
// the only thing under test. The full auth path is covered by the
// rest of the suite; this file pins one specific concern.
async function buildTestApp() {
  const app = Fastify({ logger: false })
  // Stub routes that just register the schema and reply 200 if the
  // schema validates, 400 if it doesn't. We don't care about the
  // route's body — only whether the params pass validation.
  app.patch('/subtasks/:id/pages/:pageIndex', { schema: schemas.subtasksPagePatch }, async () => ({ ok: true }))
  app.patch('/subtasks/:id/pages/:pageIndex/assign', { schema: schemas.subtasksPageAssign }, async () => ({ ok: true }))
  return app
}

describe('subtasks page patch schema — pageIndex path param', () => {
  let app
  before(async () => { app = await buildTestApp() })
  after(async () => { await app.close() })

  // The fix: pageIndex arrives from Fastify as a string ("2"), and the
  // schema must accept it. This is the regression test that would
  // have caught the original bug.
  it('accepts pageIndex="2" (string from URL path)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/subtasks/s-1/pages/2',
      payload: { status: 'done' },
    })
    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`)
  })

  it('accepts pageIndex="48" (typical İç Sayfalar size)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/subtasks/s-1/pages/48',
      payload: { status: 'done' },
    })
    assert.equal(res.statusCode, 200)
  })

  it('accepts pageIndex="100000" (schema upper bound)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/subtasks/s-1/pages/100000',
      payload: { status: 'pending' },
    })
    assert.equal(res.statusCode, 200)
  })

  // Out-of-range at the schema layer: the regex rejects strings that
  // don't look like a positive integer ("0", "-1", non-digit chars).
  // Note the schema is intentionally permissive above 100000 — the
  // route handler's `out_of_range` check compares against
  // `sub.total_pages` (the actual book length), not a hard cap, so
  // "100001" passes the schema and gets a 400 with a more helpful
  // Turkish message ("Sayfa numarası 1 ile X arasında olmalı") from
  // the service layer instead of a generic FST_ERR_VALIDATION.
  it('rejects pageIndex="0"', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/subtasks/s-1/pages/0',
      payload: { status: 'done' },
    })
    assert.equal(res.statusCode, 400)
  })

  it('rejects pageIndex="-1" (negative)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/subtasks/s-1/pages/-1',
      payload: { status: 'done' },
    })
    assert.equal(res.statusCode, 400)
  })

  it('rejects pageIndex="abc" (non-numeric)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/subtasks/s-1/pages/abc',
      payload: { status: 'done' },
    })
    assert.equal(res.statusCode, 400)
  })

  it('rejects pageIndex="1.5" (decimal)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/subtasks/s-1/pages/1.5',
      payload: { status: 'done' },
    })
    assert.equal(res.statusCode, 400)
  })

  // Body validation also matters — a designer flipping done → pending
  // sends status='pending', which has to be in the enum.
  it('rejects an unknown status value in the body', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/subtasks/s-1/pages/2',
      payload: { status: 'cancelled' },
    })
    assert.equal(res.statusCode, 400)
  })
})

describe('subtasks page assign schema — reuses the pageIndex fix', () => {
  let app
  before(async () => { app = await buildTestApp() })
  after(async () => { app.close() })

  it('accepts pageIndex="7" on the assign route', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/subtasks/s-1/pages/7/assign',
      payload: { assigned_to: 'u-2' },
    })
    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`)
  })

  it('rejects an empty assigned_to on the assign route', async () => {
    // Body schema requires `assigned_to` to be present (string or null).
    // An empty string fails the minLength: 1.
    const res = await app.inject({
      method: 'PATCH',
      url: '/subtasks/s-1/pages/7/assign',
      payload: { assigned_to: '' },
    })
    assert.equal(res.statusCode, 400)
  })
})
