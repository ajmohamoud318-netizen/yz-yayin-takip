import { attachUser, requireRole } from '../middleware/auth.js'
import { withTx, getPool } from '../db/pool.js'
import { schemas } from '../schemas/index.js'
import {
  list, create, update, remove,
} from '../services/meetings.js'
import { notifyMeetingCreated } from '../services/notifications.js'

/**
 * Toplantılar — meeting log. See migration 040__meetings.sql.
 *
 *  GET    /api/meetings       → anyone signed in
 *  POST   /api/meetings       → team_leader, designer, printer
 *  PATCH  /api/meetings/:id   → team_leader, or the meeting's own author
 *  DELETE /api/meetings/:id   → team_leader, or the meeting's own author
 */
export async function meetingRoutes(fastify) {
  fastify.get('/meetings', async (request) => {
    await attachUser(request)
    const meetings = await list(getPool())
    return { meetings }
  })

  fastify.post(
    '/meetings',
    { schema: schemas.meetingCreate },
    async (request, reply) => {
      await attachUser(request)
      requireRole(request, 'team_leader', 'designer', 'printer')
      const meeting = await withTx(async (client) => {
        const row = await create(client, request.body, request.user)
        await notifyMeetingCreated(client, { meeting: row, actor: request.user })
        return row
      })
      reply.code(201)
      return meeting
    },
  )

  fastify.patch(
    '/meetings/:id',
    { schema: schemas.meetingUpdate },
    async (request) => {
      await attachUser(request)
      return update(getPool(), request.params.id, request.user, request.body)
    },
  )

  fastify.delete(
    '/meetings/:id',
    { schema: schemas.meetingIdParams },
    async (request, reply) => {
      await attachUser(request)
      await remove(getPool(), request.params.id, request.user)
      reply.code(204)
      return null
    },
  )
}
