import { nanoid } from 'nanoid'
import { attachUser } from '../middleware/auth.js'
import { badRequest, notFound } from '../domain/errors.js'
import { getPool, withTx } from '../db/pool.js'
import { logHistory } from '../services/project-repository.js'
import { schemas } from '../schemas/index.js'

/**
 * Demos API (demo + ozalit form submissions).
 *
 * GET  /api/demos
 * POST /api/demos   — body { project_id, kind, payload }
 *
 * Each submission also writes a `stage_history` row tagged with the
 * matching event (`demo_form` / `ozalit_form`) so the project timeline
 * can show who submitted what and when.
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
    const { project_id, kind = 'demo', payload = {}, attempt, silent = false } = request.body
    const proj = await getPool().query(
      'SELECT id, demo_attempt, ozalit_attempt FROM projects WHERE id = $1', [project_id],
    )
    if (proj.rowCount === 0) notFound('Proje bulunamadı.')
    // The attempt stamps which demo/ozalit round this form belongs to, so
    // the history timeline can reopen the exact sheet later — from any
    // browser (the SPA used to keep these only in localStorage). When the
    // client doesn't send one, derive it from the project's counter.
    const fallbackAttempt =
      (kind === 'ozalit'
        ? proj.rows[0].ozalit_attempt
        : proj.rows[0].demo_attempt) ?? 0
    const attemptNo = attempt ?? fallbackAttempt + 1
    // demos.id is TEXT PRIMARY KEY with no default — the route mints a
    // `d-<nanoid>` so the INSERT satisfies NOT NULL. The prefix keeps
    // it visually distinct from user (u-…) / project (p-…) ids.
    const demoId = `d-${nanoid(16)}`
    const result = await withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO demos (id, project_id, kind, payload, attempt, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, project_id, kind, payload, attempt, created_by, created_at`,
        [demoId, project_id, kind, payload, attemptNo, request.user.id],
      )
      // Surface this in the project history list so the timeline isn't
      // missing designer submissions — unless the caller marks the save
      // `silent` (the spec-form dialog does: its advance/approve call
      // already produces the meaningful "Demoya Gönderildi" entry, and a
      // second "Demo formu gönderildi" row would just be noise).
      if (!silent) {
        const { rows: projRows } = await client.query(
          'SELECT stage FROM projects WHERE id = $1', [project_id],
        )
        const stage = projRows[0]?.stage ?? 'tasarim'
        const event = kind === 'ozalit' ? 'ozalit_form' : 'demo_form'
        const label = kind === 'ozalit' ? 'Ozalit formu gönderildi' : 'Demo formu gönderildi'
        await logHistory(
          client,
          {
            project_id,
            from_stage: stage,
            to_stage: stage,
            action: 'system',
            event,
            note: label,
          },
          request.user,
        )
      }
      return rows[0]
    })
    return result
  })
}
