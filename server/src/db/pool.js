import pg from 'pg'
import { config } from '../config.js'

/**
 * Single shared pg connection pool for the whole server.
 *
 * We import pg.Pool lazily so tests that don't need a DB can import the
 * module without paying the connect-on-import cost.
 */

let pool = null

export function getPool() {
  if (pool) return pool
  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.poolMax,
  })
  pool.on('error', (err) => {
    // pg surfaces idle-client errors here — log but don't crash the server.
    // eslint-disable-next-line no-console
    console.error('[pg] idle client error:', err)
  })
  return pool
}

/**
 * Run `fn(client)` inside a single transaction. Rolls back on throw,
 * commits on resolve. Used by routes that mutate multiple tables.
 *
 * ### After-commit hooks
 *
 * `fn` receives a client carrying an extra `client.afterCommit(cb)` method.
 * Callbacks registered through it run ONLY after `COMMIT` succeeds, detached
 * from the request (errors are swallowed, nothing is awaited).
 *
 * This exists because side effects that leave the database — sending a web
 * push, an email, a webhook — must not fire for work that later rolls back,
 * and equally must not run *inside* the transaction where they would hold a
 * pool connection open across a network round-trip.
 *
 * Scheduling such work with a bare `setImmediate` from inside `fn` does NOT
 * work: `setImmediate` fires on the next event-loop check phase, which is
 * reached long before `fn` resolves and `COMMIT` is issued. That bug shipped
 * once — push notifications for real pipeline events were silently dropped
 * because the "has it committed yet?" probe always ran too early — hence the
 * explicit hook rather than a timing assumption.
 */
export async function withTx(fn) {
  const client = await getPool().connect()
  const hooks = []
  // Registered on the client so `fn` can reach it without changing the
  // signature every existing caller and service already depends on.
  client.afterCommit = (cb) => { if (typeof cb === 'function') hooks.push(cb) }
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    // Past this line the write is durable, so the hooks are safe to run.
    // Detached and individually guarded: one failing hook must not affect
    // the response (already computed) or the other hooks.
    for (const cb of hooks) {
      setImmediate(() => {
        try {
          const r = cb()
          if (r && typeof r.catch === 'function') {
            r.catch((err) => {
              // eslint-disable-next-line no-console
              console.error('[pg] afterCommit hook rejected:', err?.message)
            })
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[pg] afterCommit hook threw:', err?.message)
        }
      })
    }
    return result
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* ignore */ }
    throw err
  } finally {
    // Clients are pooled and reused — leaving this attached would let a
    // later transaction inherit (and re-run) a previous one's hooks.
    delete client.afterCommit
    client.release()
  }
}

/** Test seam: swap in a fake pool so withTx can be unit-tested without a DB. */
export function __setPoolForTests(fake) {
  pool = fake
}

export async function closePool() {
  if (!pool) return
  await pool.end()
  pool = null
}
