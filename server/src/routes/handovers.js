import { attachUser } from '../middleware/auth.js'
import { badRequest, forbidden, notFound } from '../domain/errors.js'
import { withTx } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { assertHandoverEligible } from '../domain/pipeline.js'
import {
  getProject, getProjectForUpdate, patchProject, insertHistory,
} from '../services/project-repository.js'
import { schemas } from '../schemas/index.js'

/**
 * Teslim (handover) API: matbaa raises, satis confirms.
 *
 * GET   /api/handovers
 * POST  /api/handovers
 * PATCH /api/handovers/:id/confirm
 */
export async function handoverRoutes(fastify) {
  fastify.get('/handovers', async (request) => {
    await attachUser(request)
    const { rows } = await getPool().query(
      `SELECT h.id, h.project_id, h.status, h.from_stage, h.raised_by, h.confirmed_by,
              h.created_at, h.confirmed_at, p.title AS project_title, p.type AS project_type,
              rb.name AS raised_by_name, cb.name AS confirmed_by_name
       FROM handovers h
       JOIN projects p ON p.id = h.project_id
       LEFT JOIN users rb ON rb.id = h.raised_by
       LEFT JOIN users cb ON cb.id = h.confirmed_by
       ORDER BY h.created_at DESC`,
    )
    return rows
  })

  fastify.post('/handovers', { schema: schemas.handoversCreate }, async (request) => {
    await attachUser(request)
    if (request.user.role !== 'printer') forbidden('Yalnızca matbaa teslim oluşturabilir.')
    const { projectId } = request.body
    const project = await getProject(projectId)
    if (!project) notFound('Proje bulunamadı.')
    assertHandoverEligible(project)
    const { rows: pending } = await getPool().query(
      "SELECT id FROM handovers WHERE project_id = $1 AND status = 'pending'",
      [projectId],
    )
    if (pending.length > 0) badRequest('Bu proje için zaten bekleyen bir teslim talebi var.')
    const { rows } = await getPool().query(
      `INSERT INTO handovers (project_id, status, from_stage, raised_by)
       VALUES ($1,'pending',$2,$3)
       RETURNING id, project_id, status, from_stage, raised_by, created_at, confirmed_at`,
      [projectId, project.stage, request.user.id],
    )
    return rows[0]
  })

  fastify.patch('/handovers/:id/confirm', { schema: schemas.handoversConfirm }, async (request) => {
    await attachUser(request)
    if (request.user.role !== 'satis') forbidden('Alındı onayını yalnızca satış verebilir.')
    const result = await withTx(async (client) => {
      const { rows: ho } = await client.query(
        'SELECT * FROM handovers WHERE id = $1 FOR UPDATE', [request.params.id],
      )
      const handover = ho[0]
      if (!handover) notFound('Teslim talebi bulunamadı.')
      if (handover.status !== 'pending') badRequest('Bu teslim zaten sonuçlandırılmış.')
      const { rows } = await client.query(
        `UPDATE handovers
           SET status = 'received', confirmed_by = $2, confirmed_at = NOW()
         WHERE id = $1
         RETURNING id, project_id, status, from_stage, raised_by, confirmed_by, created_at, confirmed_at`,
        [handover.id, request.user.id],
      )
      const project = await getProjectForUpdate(client, handover.project_id)
      if (!project) notFound('Proje bulunamadı.')
      const updated = await patchProject(client, project.id, { stage: 'satista' })
      await insertHistory(client, {
        project_id: project.id, from_stage: handover.from_stage, to_stage: 'satista',
        action: 'system', done_by: request.user.id,
        note: 'Teslim onaylandı — satışta',
      })
      return { handover: rows[0], project: updated }
    })
    return result
  })
}
