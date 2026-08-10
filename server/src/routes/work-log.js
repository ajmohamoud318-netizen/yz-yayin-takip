import { attachUser } from '../middleware/auth.js'
import { getPool } from '../db/pool.js'
import { schemas } from '../schemas/index.js'
import {
  WORK_LOG_DEFAULT_DAYS, create, listMine, remove, update,
} from '../services/work-log.js'

/**
 * Work log ("Çalışma Defteri") — see migration 026__work_log.sql.
 *
 *  GET    /api/work-log            → my entries, last ?days (default 14)
 *  POST   /api/work-log            → add an entry for today
 *  PATCH  /api/work-log/:id        → edit one of mine
 *  DELETE /api/work-log/:id        → delete one of mine
 *
 * These routes never take a user id: the row is matched on
 * `user_id = request.user.id` inside the statement, so there's no id to forge.
 * Cross-user reads don't live here — the Ekip page gets each user's
 * `work_log_today` inlined on `GET /users`.
 */
export async function workLogRoutes(fastify) {
  fastify.get('/work-log', { schema: schemas.workLogListQuery }, async (request) => {
    await attachUser(request)
    const days = request.query?.days ?? WORK_LOG_DEFAULT_DAYS
    const entries = await listMine(getPool(), request.user.id, days)
    return { entries, days }
  })

  fastify.post('/work-log', { schema: schemas.workLogCreate }, async (request, reply) => {
    await attachUser(request)
    const entry = await create(getPool(), request.user.id, request.body)
    reply.code(201)
    return entry
  })

  fastify.patch('/work-log/:id', { schema: schemas.workLogUpdate }, async (request) => {
    await attachUser(request)
    return update(getPool(), request.user.id, request.params.id, request.body)
  })

  fastify.delete('/work-log/:id', { schema: schemas.workLogIdParams }, async (request, reply) => {
    await attachUser(request)
    await remove(getPool(), request.user.id, request.params.id)
    reply.code(204)
    return null
  })
}
