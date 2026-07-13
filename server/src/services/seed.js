/**
 * Idempotent seed for local dev / fresh DBs.
 *
 * Inserts the canonical team, a handful of projects spanning the full
 * pipeline, and two demo order requests. Safe to re-run — every INSERT
 * is `ON CONFLICT (id) DO NOTHING`.
 *
 * Usage:  node src/services/seed.js
 */

import { getPool, closePool } from '../db/pool.js'
import { SEED_USERS, DEMO_PASSWORD_HASH } from '../../db/seed/users.js'
import { SEED_PROJECTS, SEED_ORDER_REQUESTS, SEED_TITLES } from '../../db/seed/projects.js'

export async function seed() {
  const pool = getPool()
  for (const u of SEED_USERS) {
    await pool.query(
      `INSERT INTO users (id, name, email, password, role, is_active, joined_at)
       VALUES ($1,$2,$3,$4,$5,TRUE,$6)
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.name, u.email, DEMO_PASSWORD_HASH, u.role, u.joined_at ?? null],
    )
  }
  for (const p of SEED_PROJECTS) {
    await pool.query(
      `INSERT INTO projects (id, title, type, stage, assigned_to, created_by,
                             target_month, demo_attempt, progress, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO NOTHING`,
      [
        p.id,
        p.title,
        p.type,
        p.stage,
        p.assigned_to,
        p.created_by,
        p.target_month,
        p.demo_attempt,
        p.progress,
        p.created_at,
        p.updated_at,
      ],
    )
  }
  for (const o of SEED_ORDER_REQUESTS) {
    await pool.query(
      `INSERT INTO order_requests (id, project_id, status, requested_by, payload, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,0,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [
        o.id,
        o.project_id,
        o.status,
        o.requested_by,
        o.payload,
        o.history[0].created_at,
        o.history[o.history.length - 1].created_at,
      ],
    )
    for (const h of o.history) {
      await pool.query(
        `INSERT INTO order_history (order_id, step, signed_by_id, notes, created_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING`,
        [o.id, h.step, h.signed_by_id, h.notes ?? '', h.created_at],
      )
    }
  }
  // Trigger title cache (no-op for inserts but documented in case the seed
  // table design changes). The client reads project titles straight off
  // `projects.title` via the GET /projects endpoint.
  void SEED_TITLES
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ;(async () => {
    try {
      await seed()
      // eslint-disable-next-line no-console
      console.log('[seed] done')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[seed] failed:', err.message)
      process.exitCode = 1
    } finally {
      await closePool()
    }
  })()
}
