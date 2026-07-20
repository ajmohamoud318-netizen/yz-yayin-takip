import { attachUser, requireRole } from '../middleware/auth.js'
import { badRequest, notFound } from '../domain/errors.js'
import { withTx } from '../db/pool.js'
import {
  getProject, getProjectForUpdate, patchProject, insertHistory,
} from '../services/project-repository.js'
import { schemas } from '../schemas/index.js'
import { subtaskProgress } from '../domain/progress.js'
import { progressFor } from '../domain/progress.js'

/**
 * Subtask API.
 *
 * PATCH /api/subtasks/:id                 — toggle or update fields
 * POST  /api/subtasks/:id/updates         — append a designer note
 * PUT   /api/projects/:id/subtasks        — team_leader bulk replaces the list
 *
 * The `progress` field on the parent project is recomputed in the same
 * transaction so the client cache stays valid.
 */
export async function subtaskRoutes(fastify) {
  fastify.patch('/subtasks/:id', { schema: schemas.subtasksPatch }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const { rows: subRows } = await client.query(
        'SELECT * FROM subtasks WHERE id = $1 FOR UPDATE', [request.params.id],
      )
      const sub = subRows[0]
      if (!sub) notFound('Alt görev bulunamadı.')
      const project = await getProjectForUpdate(client, sub.project_id)
      const allowed = {}
      if (typeof request.body.is_done === 'boolean') {
        allowed.is_done = request.body.is_done
        allowed.done_at = request.body.is_done ? new Date().toISOString() : null
      }
      if (Number.isFinite(request.body.pages_done)) allowed.pages_done = request.body.pages_done
      if (Number.isFinite(request.body.stickers_done)) allowed.stickers_done = request.body.stickers_done
      if (Object.keys(allowed).length === 0) badRequest('Geçerli alan yok.')
      const cols = Object.keys(allowed)
      const setSql = cols.map((c, i) => `${c} = $${i + 2}`).join(', ')
      const { rows: updatedSub } = await client.query(
        `UPDATE subtasks SET ${setSql}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [sub.id, ...cols.map((c) => allowed[c])],
      )
      const { rows: projectSubs } = await client.query(
        'SELECT * FROM subtasks WHERE project_id = $1', [project.id],
      )
      const progress = progressFor(project, projectSubs)
      const updProject = await patchProject(client, project.id, { progress })
      return { subtask: updatedSub[0], project: updProject }
    })
    // Returning the full project so the client can refresh its tile without
    // a follow-up GET.
    return result.project
  })

  fastify.post('/subtasks/:id/updates', { schema: schemas.subtasksUpdates }, async (request) => {
    await attachUser(request)
    const { note } = request.body
    const result = await withTx(async (client) => {
      const { rows: subRows } = await client.query(
        'SELECT id, project_id FROM subtasks WHERE id = $1', [request.params.id],
      )
      const sub = subRows[0]
      if (!sub) notFound('Alt görev bulunamadı.')
      const { rows } = await client.query(
        `INSERT INTO subtask_updates (subtask_id, note, author_id)
         VALUES ($1,$2,$3) RETURNING *`,
        [sub.id, note, request.user.id],
      )
      const project = await getProjectForUpdate(client, sub.project_id)
      return { project, entry: rows[0] }
    })
    return result
  })

  fastify.put('/projects/:id/subtasks', { schema: schemas.projectsSubtasksPut }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const project = await getProject(request.params.id)
    if (!project) notFound('Proje bulunamadı.')
    const subtasks = request.body.subtasks
    const result = await withTx(async (client) => {
      await client.query('DELETE FROM subtasks WHERE project_id = $1', [project.id])
      const inserted = []
      for (const s of subtasks) {
        const { rows } = await client.query(
          `INSERT INTO subtasks (project_id, title, kind, total_pages, total_stickers, is_done)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [project.id, s.title, s.kind ?? 'check', s.total_pages ?? null, s.total_stickers ?? null, !!s.is_done],
        )
        inserted.push(rows[0])
      }
      const progress = progressFor(project, inserted)
      const updated = await patchProject(client, project.id, { progress })
      await insertHistory(client, {
        project_id: project.id, from_stage: project.stage, to_stage: project.stage,
        action: 'system', note: 'Alt görev listesi güncellendi',
      })
      return { project: updated, subtasks: inserted, progress }
    })
    return result
  })
}
