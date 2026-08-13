import test from 'node:test'
import assert from 'node:assert/strict'
import {
  listForUser, countsForUser, classifyDelivery, FEED_MAX_PAGE_SIZE,
} from './notifications.js'

/**
 * Feed query contract tests.
 *
 * These cover the two bugs migration 034's pass fixed on the read path, both
 * of which were invisible in a small dataset and only surfaced once someone
 * accumulated more than one page of notifications:
 *
 *   1. `unread` / `unseen` were counted by looping the 50-row page the feed
 *      had just fetched, so the badge was capped and wrong past 50.
 *   2. There was no cursor at all — rows 51+ were unreachable.
 *
 * They run against a fake client rather than Postgres (the rest of the suite
 * does the same) so the SQL SHAPE and the parameter binding are what's locked
 * down: those are what silently drift.
 */

/** Minimal pg-client stand-in that records the query it was handed. */
function fakeClient(rows = []) {
  const calls = []
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values })
      return { rows, rowCount: rows.length }
    },
  }
}

test('countsForUser returns real totals, not page-derived ones', async () => {
  // The aggregate must come back from SQL. If someone reverts to counting the
  // page in JS, the query below stops being a COUNT and this fails.
  const client = fakeClient([{ unread: '73', unseen: '61' }])
  const counts = await countsForUser(client, 'u-ayse')

  assert.deepEqual(counts, { unread: 73, unseen: 61 })
  const { text, values } = client.calls[0]
  assert.match(text, /COUNT\(\*\) FILTER \(WHERE is_read = FALSE\)/)
  assert.match(text, /COUNT\(\*\) FILTER \(WHERE seen\s+= FALSE\)/)
  assert.deepEqual(values, ['u-ayse'])
  // Crucially: no LIMIT. A limited count is the exact bug being fixed.
  assert.ok(!/LIMIT/i.test(text), 'the count query must not be paginated')
})

test('countsForUser coerces pg bigint strings to numbers', async () => {
  // pg returns COUNT() as a string. `"0" > 0` is false but `"0"` is truthy —
  // shipping the raw value makes the badge render on an empty feed.
  const counts = await countsForUser(fakeClient([{ unread: '0', unseen: '0' }]), 'u-x')
  assert.strictEqual(counts.unread, 0)
  assert.strictEqual(counts.unseen, 0)
  assert.equal(typeof counts.unseen, 'number')
})

test('countsForUser survives an empty result row', async () => {
  const counts = await countsForUser(fakeClient([]), 'u-x')
  assert.deepEqual(counts, { unread: 0, unseen: 0 })
})

test('listForUser without a cursor binds nulls and returns the newest page', async () => {
  const client = fakeClient([])
  await listForUser(client, 'u-ayse')
  const { text, values } = client.calls[0]

  assert.equal(values[0], 'u-ayse')
  assert.equal(values[1], 50, 'default page size')
  assert.equal(values[2], null)
  assert.equal(values[3], null)
  // The NULL guard is what makes one query serve both the first page and
  // subsequent ones — without it the cursor comparison would drop every row.
  assert.match(text, /\$3::timestamptz IS NULL OR/)
})

test('listForUser paginates on the (created_at, id) tuple, not created_at alone', async () => {
  // A single emit() writes every recipient's row in ONE statement, so rows
  // routinely share created_at to the microsecond. A timestamp-only cursor
  // silently drops one of them at a page boundary.
  const client = fakeClient([])
  await listForUser(client, 'u-ayse', { cursor: { createdAt: '2026-08-13T09:00:00.000Z', id: 'n-42' } })
  const { text, values } = client.calls[0]

  assert.match(text, /\(created_at, id\) < \(\$3::timestamptz, \$4::text\)/)
  assert.equal(values[2], '2026-08-13T09:00:00.000Z')
  assert.equal(values[3], 'n-42')
})

test('listForUser orders by the same tuple it pages on', async () => {
  // ORDER BY created_at DESC, id (ascending) — the pre-existing order — does
  // not match a `(created_at, id) <` cursor, and the mismatch loses rows.
  const client = fakeClient([])
  await listForUser(client, 'u-x')
  assert.match(client.calls[0].text, /ORDER BY created_at DESC, id DESC/)
})

test('listForUser clamps the page size', async () => {
  const cases = [
    [500, FEED_MAX_PAGE_SIZE],
    [0, 50],
    [-10, 50],
    [Number.NaN, 50],
    ['25', 25],
    [25, 25],
  ]
  for (const [input, expected] of cases) {
    const client = fakeClient([])
    await listForUser(client, 'u-x', { limit: input })
    assert.equal(client.calls[0].values[1], expected, `limit ${String(input)}`)
  }
})

/* --------------------------- outbox classification ------------------------ */

/**
 * The rule that decides whether a push is owed again. Getting it backwards is
 * either a lost notification (settling something that never sent) or an
 * infinite retry loop that fills the pending index — and neither shows up in
 * manual testing, because both look identical from the bell.
 */

const stats = (sent, transient, dead) => ({ sent, transient, dead })

test('a delivered push settles', () => {
  const r = classifyDelivery(new Map([['n-1', stats(2, 0, 0)]]))
  assert.deepEqual(r.settled, ['n-1'])
  assert.deepEqual(r.retry, [])
  assert.equal(r.delivered, 2)
})

test('partial success settles — delivered once is delivered', () => {
  // One of the user's two devices took it, the other timed out. Retrying to
  // reach the second device would re-buzz the first for the same event.
  const r = classifyDelivery(new Map([['n-1', stats(1, 1, 0)]]))
  assert.deepEqual(r.settled, ['n-1'])
  assert.deepEqual(r.retry, [])
})

test('a recipient with no devices settles rather than retrying forever', () => {
  const r = classifyDelivery(new Map([['n-1', stats(0, 0, 0)]]))
  assert.deepEqual(r.settled, ['n-1'])
  assert.deepEqual(r.retry, [])
  assert.equal(r.delivered, 0)
})

test('only-dead devices settle — 404/410 is permanent, not retryable', () => {
  const r = classifyDelivery(new Map([['n-1', stats(0, 0, 3)]]))
  assert.deepEqual(r.settled, ['n-1'])
  assert.deepEqual(r.retry, [])
})

test('a purely transient failure stays owed', () => {
  const r = classifyDelivery(new Map([['n-1', stats(0, 2, 0)]]))
  assert.deepEqual(r.settled, [])
  assert.deepEqual(r.retry, ['n-1'])
})

test('each notification in a batch is classified independently', () => {
  // One emit fans out to N recipients as N rows. A single failing device must
  // not hold back the other recipients' rows, and vice versa.
  const r = classifyDelivery(new Map([
    ['n-1', stats(1, 0, 0)],
    ['n-2', stats(0, 1, 0)],
    ['n-3', stats(0, 0, 1)],
    ['n-4', stats(0, 0, 0)],
  ]))
  assert.deepEqual(r.settled.sort(), ['n-1', 'n-3', 'n-4'])
  assert.deepEqual(r.retry, ['n-2'])
  assert.equal(r.delivered, 1)
})

test('classifyDelivery tolerates an empty or missing result set', () => {
  for (const input of [new Map(), null, undefined]) {
    const r = classifyDelivery(input)
    assert.deepEqual(r, { delivered: 0, settled: [], retry: [] })
  }
})
