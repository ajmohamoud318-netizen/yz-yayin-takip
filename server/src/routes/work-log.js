import { attachUser, requireRole } from '../middleware/auth.js'
import { getPool } from '../db/pool.js'
import { schemas } from '../schemas/index.js'
import {
  WORK_LOG_DEFAULT_DAYS, create, listForDate, listMine, remove, update,
} from '../services/work-log.js'

/**
 * Work log ("Çalışma Defteri") — see migration 026__work_log.sql.
 *
 *  GET    /api/work-log            → my entries, last ?days (default 14)
 *  POST   /api/work-log            → add an entry for today
 *  PATCH  /api/work-log/:id        → edit one of mine
 *  DELETE /api/work-log/:id        → delete one of mine
 *  GET    /api/work-log/team       → everyone's entries for ?date (leader only)
 *
 * The four owner-scoped routes never take a user id: the row is matched on
 * `user_id = request.user.id` inside the statement, so there's no id to forge.
 * `/team` is the only cross-user read and it requires team_leader.
 *
 * Note the route order — Fastify's radix router keeps the static
 * `/work-log/team` distinct from `/work-log/:id`, so no shadowing here, but
 * the static route is declared first anyway to keep that obvious to readers.
 */
export async function workLogRoutes(fastify) {
  fastify.get('/work-log/team', { schema: schemas.workLogTeamQuery }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    // Default to today; an explicit ?date lets the leader look back at the
    // day a project stalled without loading everyone's full history.
    const date = request.query?.date ?? new Date().toISOString().slice(0, 10)
    const entries = await listForDate(getPool(), date)
    return { date, entries }
  })

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
