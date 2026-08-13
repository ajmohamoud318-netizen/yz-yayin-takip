import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPayload, __testing } from './push.js'

/**
 * Payload contract tests.
 *
 * These lock the shape sw.js reads. The service worker is deployed as a
 * separate static file with its own cache lifetime, so a payload field
 * renamed here but not there fails SILENTLY in production — the push
 * arrives, the worker reads `undefined`, and the user gets a generic
 * notification with no working link. Cheap tests, expensive bug.
 */

test('buildPayload: routes to the explicit link when present', () => {
  const p = JSON.parse(buildPayload({
    type: 'handover_requested',
    title: 'Matematik 8',
    body: 'Teslim onayı bekleniyor',
    tone: 'amber',
    link: '/approvals/teslim',
    projectId: 'p-abc',
  }))
  assert.equal(p.url, '/approvals/teslim')
  assert.equal(p.title, 'Matematik 8')
  assert.equal(p.tone, 'amber')
})

test('buildPayload: falls back to the project route, then home', () => {
  const withProject = JSON.parse(buildPayload({ type: 'assignment', projectId: 'p-abc' }))
  assert.equal(withProject.url, '/projects/p-abc')

  const bare = JSON.parse(buildPayload({ type: 'info' }))
  assert.equal(bare.url, '/')
})

test('buildPayload: carries the recipient-specific notification id', () => {
  // sw.js round-trips this back to PushBridge so the tap can mark THAT row
  // read. It must be the id of the recipient's own row — sendToRecipients
  // builds one entry per recipient precisely so this can't be shared.
  const p = JSON.parse(buildPayload({ type: 'assignment', notificationId: 'n-42' }))
  assert.equal(p.id, 'n-42')

  // Absent rather than undefined: the worker reads `data.id ?? null` and must
  // not end up posting `undefined` to the app.
  const bare = JSON.parse(buildPayload({ type: 'info' }))
  assert.equal(bare.id, null)
})

test('buildPayload: never emits an empty title', () => {
  // An empty title renders as a blank notification banner on Android.
  const p = JSON.parse(buildPayload({ type: 'info', title: '' }))
  assert.equal(p.title, 'YZ Yayın Takip')
})

test('buildPayload: tags by project so repeat events collapse', () => {
  // Two events about the same book must share a tag — otherwise a busy
  // project stacks five separate banners on the printer's lock screen.
  const a = JSON.parse(buildPayload({ type: 'demo_ready', projectId: 'p-abc' }))
  const b = JSON.parse(buildPayload({ type: 'ozalit_requested', projectId: 'p-abc' }))
  assert.equal(a.tag, b.tag)
  assert.equal(a.tag, 'project-p-abc')

  const c = JSON.parse(buildPayload({ type: 'info', notificationId: 'n-1' }))
  assert.equal(c.tag, 'notif-n-1')
})

/* ------------------------- fan-out concurrency --------------------------- */

const { mapWithConcurrency, MAX_CONCURRENT_SENDS } = __testing

test('mapWithConcurrency visits every item exactly once', async () => {
  // The fan-out replaced an unbounded Promise.all with a worker-pool cursor.
  // A dropped item here is a push nobody ever receives and nobody reports.
  const items = Array.from({ length: 57 }, (_, i) => i)
  const seen = []
  await mapWithConcurrency(items, 8, async (n) => {
    await new Promise((r) => setTimeout(r, n % 3))
    seen.push(n)
  })
  assert.equal(seen.length, items.length)
  assert.deepEqual([...seen].sort((a, b) => a - b), items)
})

test('mapWithConcurrency never exceeds the limit', async () => {
  let inFlight = 0
  let peak = 0
  await mapWithConcurrency(Array.from({ length: 40 }, (_, i) => i), 5, async () => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 1))
    inFlight -= 1
  })
  assert.ok(peak <= 5, `peak concurrency was ${peak}`)
  assert.ok(peak > 1, 'work should actually run in parallel')
})

test('mapWithConcurrency handles fewer items than workers, and none at all', async () => {
  const seen = []
  await mapWithConcurrency([1, 2], MAX_CONCURRENT_SENDS, async (n) => { seen.push(n) })
  assert.deepEqual(seen.sort(), [1, 2])
  await mapWithConcurrency([], MAX_CONCURRENT_SENDS, async () => {
    assert.fail('worker must not run for an empty list')
  })
})

test('buildPayload: stays well inside the ~4KB push service limit', () => {
  // Push services reject oversized payloads outright. Body text comes from
  // project titles, which are user-supplied and unbounded.
  const payload = buildPayload({
    type: 'rejection',
    title: 'x'.repeat(300),
    body: 'y'.repeat(500),
    projectId: 'p-abc',
  })
  assert.ok(Buffer.byteLength(payload, 'utf8') < 4096, 'payload must fit in 4KB')
})
