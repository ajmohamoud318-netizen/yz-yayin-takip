import { attachUser, requireRole } from '../middleware/auth.js'
import { withTx, getPool } from '../db/pool.js'
import { schemas } from '../schemas/index.js'
import { list, create, remove } from '../services/target-project-ideas.js'
import { notifyTargetProjectIdeaCreated } from '../services/notifications.js'

/**
 * Hedef Projeler — idea board on Baskı Listesi. See migration
 * 036__target_project_ideas.sql.
 *
 *  GET    /api/target-project-ideas       → anyone signed in
 *  POST   /api/target-project-ideas       → designer + team_leader
 *  DELETE /api/target-project-ideas/:id   → team_leader, or the idea's own author
 */
export async function targetProjectIdeaRoutes(fastify) {
  fastify.get('/target-project-ideas', async (request) => {
    await attachUser(request)
    const ideas = await list(getPool())
    return { ideas }
  })

  fastify.post(
    '/target-project-ideas',
    { schema: schemas.targetProjectIdeaCreate },
    async (request, reply) => {
      await attachUser(request)
      requireRole(request, 'team_leader', 'designer')
      const idea = await withTx(async (client) => {
        const row = await create(client, request.body, request.user)
        await notifyTargetProjectIdeaCreated(client, { idea: row, actor: request.user })
        return row
      })
      reply.code(201)
      return idea
    },
  )

  fastify.delete(
    '/target-project-ideas/:id',
    { schema: schemas.targetProjectIdeaIdParams },
    async (request, reply) => {
      await attachUser(request)
      await remove(getPool(), request.params.id, request.user)
      reply.code(204)
      return null
    },
  )
}
