import test from 'node:test'
import assert from 'node:assert/strict'
import { withTx, __setPoolForTests } from './pool.js'

/**
 * Regression tests for withTx's after-commit hooks.
 *
 * These exist because of a shipped bug: web push for real pipeline events was
 * scheduled from inside the transaction with `setImmediate` plus a "are the
 * rows visible yet?" probe. `setImmediate` fires on the next event-loop check
 * phase — long before the callback resolves and COMMIT is issued — so the
 * probe always found nothing and every push was silently dropped. Nothing
 * errored; notifications simply never arrived.
 *
 * The invariant worth protecting is narrow and absolute: a hook runs after
 * COMMIT, or it does not run at all.
 */

/** Minimal pg pool double that records the SQL it was asked to run. */
function fakePool() {
  const queries = []
  const client = {
    query: async (sql) => { queries.push(typeof sql === 'string' ? sql : sql.text); return { rows: [] } },
    release: () => { client.released = true },
    released: false,
  }
  return { queries, client, connect: async () => client }
}

test('afterCommit hooks run only after COMMIT is issued', async () => {
  const pool = fakePool()
  __setPoolForTests(pool)

  let ranAt = null
  await withTx(async (client) => {
    client.afterCommit(() => { ranAt = [...pool.queries] })
    // Simulate the real shape: more awaited work AFTER emit() registers its
    // hook. This is the window the old setImmediate version fired inside.
    await client.query('INSERT INTO notifications ...')
    await new Promise((r) => setTimeout(r, 5))
    await client.query('UPDATE projects ...')
  })

  assert.equal(ranAt, null, 'hook must not have run synchronously within withTx')
  await new Promise((r) => setImmediate(r))

  assert.ok(ranAt, 'hook should have run after withTx resolved')
  assert.ok(ranAt.includes('COMMIT'), 'COMMIT must already be issued when the hook runs')
  assert.equal(ranAt[ranAt.length - 1], 'COMMIT', 'hook must run after COMMIT, not before')
})

test('afterCommit hooks do NOT run when the transaction rolls back', async () => {
  const pool = fakePool()
  __setPoolForTests(pool)

  let ran = false
  await assert.rejects(withTx(async (client) => {
    client.afterCommit(() => { ran = true })
    throw new Error('boom')
  }), /boom/)

  await new Promise((r) => setImmediate(r))
  assert.equal(ran, false, 'a rolled-back transaction must never fire its hooks')
  assert.ok(pool.queries.includes('ROLLBACK'))
  assert.ok(!pool.queries.includes('COMMIT'))
})

test('a throwing hook cannot break the transaction or the other hooks', async () => {
  const pool = fakePool()
  __setPoolForTests(pool)

  let second = false
  const result = await withTx(async (client) => {
    client.afterCommit(() => { throw new Error('hook exploded') })
    client.afterCommit(() => { second = true })
    return 'ok'
  })

  assert.equal(result, 'ok', 'the caller still gets its result')
  await new Promise((r) => setImmediate(r))
  assert.equal(second, true, 'a failing hook must not prevent later hooks')
})

test('hooks are not inherited by the next transaction on a pooled client', async () => {
  // Clients are reused from the pool. If afterCommit survived release, a
  // later unrelated transaction would re-fire the previous one's pushes.
  const pool = fakePool()
  __setPoolForTests(pool)

  let count = 0
  await withTx(async (client) => { client.afterCommit(() => { count += 1 }) })
  await new Promise((r) => setImmediate(r))
  assert.equal(count, 1)

  await withTx(async () => { /* registers nothing */ })
  await new Promise((r) => setImmediate(r))
  assert.equal(count, 1, 'previous transaction hooks must not re-run')
})
