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
 */
export async function withTx(fn) {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* ignore */ }
    throw err
  } finally {
    client.release()
  }
}

export async function closePool() {
  if (!pool) return
  await pool.end()
  pool = null
}
