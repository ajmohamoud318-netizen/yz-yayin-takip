import { attachUser, requireRole } from '../middleware/auth.js'
import { badRequest, notFound } from '../domain/errors.js'
import { withTx, getPool } from '../db/pool.js'
import {
  listProjects, getProject, getProjectForUpdate,
  listProjectSubtasks, listProjectHistory,
  patchProject, deleteProject, insertProject, insertHistory,
} from '../services/project-repository.js'
import { schemas } from '../schemas/index.js'
import { subtaskProgress } from '../domain/progress.js'
import {
  applyAdvance, applyApproval, applyRejection,
} from '../services/project-transitions.js'

/**
 * Projects + stage transition API.
 *
 * GET    /api/projects
 * GET    /api/projects/:id           — returns project + subtasks + history
 * POST   /api/projects
 * PATCH  /api/projects/:id
 * DELETE /api/projects/:id
 * POST   /api/projects/:id/advance
 * POST   /api/projects/:id/approve
 * POST   /api/projects/:id/reject
 */

export async function projectRoutes(fastify) {
  fastify.get('/projects', async (request) => {
    await attachUser(request)
    return listProjects()
  })

  fastify.get('/projects/:id', async (request) => {
    await attachUser(request)
    const project = await getProject(request.params.id)
    if (!project) notFound('Proje bulunamadı.')
    const [subtasks, history, assignees] = await Promise.all([
      listProjectSubtasks(getPool(), project.id),
      listProjectHistory(getPool(), project.id),
      loadAssignees(project),
    ])
    return {
      ...project,
      assignees,
      assigned_name: assignees.map((a) => a.name).join(', ') || project.assigned_name || '—',
      subtasks,
      history,
    }
  })

  fastify.post('/projects', { schema: schemas.projectsCreate }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const { title, type, target_month, subtasks = [], pass_kind } = request.body
    const result = await withTx(async (client) => {
      const project = await insertProject(client, {
        title, type, target_month, pass_kind, created_by: request.user.id,
      })
      const subRows = []
      for (const s of subtasks) {
        const { rows } = await client.query(
          `INSERT INTO subtasks (project_id, title, kind, total_pages, total_stickers)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [project.id, s.title, s.kind ?? 'check', s.total_pages ?? null, s.total_stickers ?? null],
        )
        subRows.push(rows[0])
      }
      const progress = subtaskProgress(subRows)
      const updated = await patchProject(client, project.id, { progress })
      await insertHistory(client, {
        project_id: project.id, from_stage: null, to_stage: 'tasarim',
        action: 'create', done_by: request.user.id, note: 'Proje oluşturuldu',
      })
      return { ...updated, subtasks: subRows, history: [] }
    })
    return result
  })

  fastify.patch('/projects/:id', { schema: schemas.projectsPatch }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    // Schema already restricts to the allowed keys, so no manual filter.
    const fields = request.body
    const result = await withTx(async (client) => {
      const updated = await patchProject(client, request.params.id, fields)
      if (!updated) notFound('Proje bulunamadı.')
      return updated
    })
    return result
  })

  fastify.delete('/projects/:id', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    await deleteProject(request.params.id)
    return { ok: true }
  })

  fastify.post('/projects/:id/advance', { schema: schemas.projectsAdvance }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      const { project: next, history } = applyAdvance(project, {
        user: request.user, note: request.body?.note ?? '',
      })
      const updated = await patchProject(client, project.id, {
        stage: next.stage, version: next.version,
      })
      if (history) await insertHistory(client, { ...history, done_by: request.user.id })
      return updated
    })
    return result
  })

  fastify.post('/projects/:id/approve', { schema: schemas.projectsApprove }, async (request) => {
    await attachUser(request)
    const { stage, note } = request.body
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      const { project: next, history } = applyApproval(project, {
        user: request.user, stage, note: note ?? '',
      })
      // Persist all state-mutating fields from the transition (stage,
      // optimistic-lock version, AND-rule flags for ozalit_onay).
      const fields = { stage: next.stage, version: next.version }
      if (Object.prototype.hasOwnProperty.call(next, 'ozalit_leader_approved')) {
        fields.ozalit_leader_approved = next.ozalit_leader_approved
      }
      if (Object.prototype.hasOwnProperty.call(next, 'ozalit_leader_approved_by')) {
        fields.ozalit_leader_approved_by = next.ozalit_leader_approved_by
      }
      if (Object.prototype.hasOwnProperty.call(next, 'ozalit_leader_approved_at')) {
        fields.ozalit_leader_approved_at = next.ozalit_leader_approved_at
      }
      if (Object.prototype.hasOwnProperty.call(next, 'ozalit_designer_approvals')) {
        fields.ozalit_designer_approvals = JSON.stringify(next.ozalit_designer_approvals)
      }
      const updated = await patchProject(client, project.id, fields)
      if (history) await insertHistory(client, { ...history, done_by: request.user.id })
      return updated
    })
    return result
  })

  fastify.post('/projects/:id/reject', { schema: schemas.projectsReject }, async (request) => {
    await attachUser(request)
    const { stage, reason, reject_target: rejectTarget, note } = request.body
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      const { project: next, history } = applyRejection(project, {
        user: request.user, stage, reason, rejectTarget, note,
      })
      const updated = await patchProject(client, project.id, {
        stage: next.stage,
        demo_attempt: next.demo_attempt,
        ozalit_attempt: next.ozalit_attempt,
        last_reject_reason: next.last_reject_reason,
        version: next.version,
      })
      await insertHistory(client, { ...history, done_by: request.user.id })
      return updated
    })
    return result
  })
}

async function loadAssignees(project) {
  if (!project.assigned_to) return []
  const { rows } = await getPool().query(
    'SELECT id, name FROM users WHERE id = $1',
    [project.assigned_to],
  )
  return rows
}
