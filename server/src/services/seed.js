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

/**
 * Lazy seed imports.
 *
 * The seed data lives in `db/seed/*` and is intentionally NOT copied
 * into the runtime image (it's large and unused in prod). Trying to
 * import those modules at the top of this file makes Node crash at
 * boot — even when `SEED_ON_BOOT=false` and `seed()` is never called —
 * because ESM resolves static `import` statements before any code in
 * the importing module runs.
 *
 * Lazy-loading inside `seed()` keeps the boot path lean and makes the
 * missing seed files a real CLI-side error rather than a crash loop.
 */
async function loadSeed() {
  const [usersMod, projMod] = await Promise.all([
    import('../../db/seed/users.js').catch((err) => {
      console.warn('[seed] users seed missing in runtime image:', err.message)
      return null
    }),
    import('../../db/seed/projects.js').catch((err) => {
      console.warn('[seed] projects seed missing in runtime image:', err.message)
      return null
    }),
  ])
  return {
    SEED_USERS: usersMod?.SEED_USERS ?? [],
    DEMO_PASSWORD_HASH: usersMod?.DEMO_PASSWORD_HASH ?? null,
    SEED_PROJECTS: projMod?.SEED_PROJECTS ?? [],
    SEED_ORDER_REQUESTS: projMod?.SEED_ORDER_REQUESTS ?? [],
  }
}

export async function seed() {
  let bundle
  try {
    bundle = await loadSeed()
  } catch (err) {
    console.error('[seed] could not load seed files:', err.message)
    return
  }
  const { SEED_USERS, DEMO_PASSWORD_HASH, SEED_PROJECTS, SEED_ORDER_REQUESTS } =
    bundle
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
