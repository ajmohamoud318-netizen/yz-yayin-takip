import test from 'node:test'
import assert from 'node:assert/strict'
import { appendDomainEvent, queryEventsSince, queryEventsForAggregate } from './event-store.js'

/**
 * Event store contract tests.
 *
 * These guard the SQL shape and parameter binding for the domain_events table.
 * They run against a fake client (no real Postgres) so the query structure is
 * what's locked down: that's what silently drifts when someone refactors.
 *
 * The event store is the append-only log that captures every business event
 * in the same transaction as the state change and notification rows. One row
 * per business occurrence (not per recipient) — a single emit() that notifies
 * 5 users creates 5 notification rows but only 1 domain_event.
 */

/** Minimal pg-client stand-in that records queries and returns canned rows. */
function fakeClient(returnRows = []) {
  const calls = []
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values })
      return { rows: returnRows, rowCount: returnRows.length }
    },
  }
}

test('appendDomainEvent inserts with the right columns and returns the event id', async () => {
  const client = fakeClient([{ id: 'ev-42', created_at: '2026-08-28T10:00:00Z' }])
  const result = await appendDomainEvent(client, {
    eventType: 'project.transition',
    aggregateId: 'p-1',
    actorId: 'u-ayse',
    payload: { type: 'demo_approval_pending', title: 'Test Project' },
  })

  assert.deepEqual(result, { id: 'ev-42', created_at: '2026-08-28T10:00:00Z' })
  const { text, values } = client.calls[0]
  assert.match(text, /INTO domain_events/)
  assert.match(text, /event_type, aggregate_id, actor_id, payload/)
  assert.match(text, /RETURNING id, created_at/)
  assert.equal(values[0], 'project.transition')
  assert.equal(values[1], 'p-1')
  assert.equal(values[2], 'u-ayse')
  // Payload is JSON-stringified before insertion.
  assert.equal(typeof values[3], 'string')
  assert.deepEqual(JSON.parse(values[3]), { type: 'demo_approval_pending', title: 'Test Project' })
})

test('appendDomainEvent handles null aggregateId and actorId', async () => {
  const client = fakeClient([{ id: 'ev-1', created_at: new Date() }])
  await appendDomainEvent(client, {
    eventType: 'system.boot',
    aggregateId: null,
    actorId: null,
    payload: { message: 'Server started' },
  })

  const { values } = client.calls[0]
  assert.equal(values[1], null)
  assert.equal(values[2], null)
})

test('appendDomainEvent defaults empty payload to {}', async () => {
  const client = fakeClient([{ id: 'ev-1', created_at: new Date() }])
  await appendDomainEvent(client, {
    eventType: 'test.event',
    aggregateId: 'p-1',
    actorId: 'u-1',
    payload: undefined,
  })

  const { values } = client.calls[0]
  assert.equal(values[3], '{}')
})

test('queryEventsSince queries events newer than a given id', async () => {
  const client = fakeClient([
    { id: 'ev-2', event_type: 'project.transition', created_at: '2026-08-28T10:01:00Z' },
    { id: 'ev-3', event_type: 'order.approved', created_at: '2026-08-28T10:02:00Z' },
  ])
  const events = await queryEventsSince(client, { sinceId: 'ev-1', limit: 50 })

  assert.equal(events.length, 2)
  const { text, values } = client.calls[0]
  assert.match(text, /WHERE.*id > \$1::text/)
  assert.match(text, /ORDER BY created_at, id/)
  assert.match(text, /LIMIT \$2/)
  assert.equal(values[0], 'ev-1')
  assert.equal(values[1], 50)
})

test('queryEventsSince with null sinceId returns all events', async () => {
  const client = fakeClient([])
  await queryEventsSince(client, { sinceId: null, limit: 100 })

  const { text, values } = client.calls[0]
  assert.match(text, /\$1::text IS NULL OR/)
  assert.equal(values[0], null)
})

test('queryEventsForAggregate queries events for a specific aggregate', async () => {
  const client = fakeClient([
    { id: 'ev-1', event_type: 'project.created', aggregate_id: 'p-1' },
    { id: 'ev-2', event_type: 'project.transition', aggregate_id: 'p-1' },
  ])
  const events = await queryEventsForAggregate(client, 'p-1', { limit: 50 })

  assert.equal(events.length, 2)
  const { text, values } = client.calls[0]
  assert.match(text, /WHERE aggregate_id = \$1/)
  assert.match(text, /ORDER BY created_at DESC, id DESC/)
  assert.equal(values[0], 'p-1')
  assert.equal(values[1], 50)
})

test('queryEventsForAggregate defaults limit to 100', async () => {
  const client = fakeClient([])
  await queryEventsForAggregate(client, 'p-1')

  const { values } = client.calls[0]
  assert.equal(values[1], 100)
})

