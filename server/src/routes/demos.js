import { nanoid } from 'nanoid'
import { attachUser } from '../middleware/auth.js'
import { badRequest, notFound } from '../domain/errors.js'
import { getPool } from '../db/pool.js'
import { schemas } from '../schemas/index.js'

/**
 * Demos API (demo + ozalit form submissions).
 *
 * GET  /api/demos
 * POST /api/demos   — body { project_id, kind, payload }
 */
export async function demoRoutes(fastify) {
  fastify.get('/demos', async (request) => {
    await attachUser(request)
    const { rows } = await getPool().query(
      'SELECT id, project_id, kind, payload, attempt, created_by, created_at FROM demos ORDER BY created_at DESC',
    )
    return rows
  })

  fastify.post('/demos', { schema: schemas.demosCreate }, async (request) => {
    await attachUser(request)
    const { project_id, kind = 'demo', payload = {} } = request.body
    const proj = await getPool().query('SELECT id FROM projects WHERE id = $1', [project_id])
    if (proj.rowCount === 0) notFound('Proje bulunamadı.')
    // demos.id is TEXT PRIMARY KEY with no default — the route mints a
    // `d-<nanoid>` so the INSERT satisfies NOT NULL. The prefix keeps
    // it visually distinct from user (u-…) / project (p-…) ids.
    const demoId = `d-${nanoid(16)}`
    const { rows } = await getPool().query(
      `INSERT INTO demos (id, project_id, kind, payload, created_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, project_id, kind, payload, attempt, created_by, created_at`,
      [demoId, project_id, kind, payload, request.user.id],
    )
    return rows[0]
  })
}
