import { attachUser, requireRole } from '../middleware/auth.js'
import { badRequest, notFound } from '../domain/errors.js'
import { withTx, getPool } from '../db/pool.js'
import {
  listProjects, getProject, getProjectForUpdate,
  listProjectSubtasks, listProjectHistory,
  loadProjectAssignees,
  patchProject, deleteProject, insertProject, logHistory,
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

// Human-readable labels for each editable column. The PATCH route builds a
// `project_edit` history entry by looking up the field name in this map so
// the timeline reads naturally ("Başlık değiştirildi → Yeni Kitap Adı"),
// not as raw SQL column names.
const PROJECT_FIELD_LABELS = {
  title: 'Başlık',
  type: 'Tür (TR / ÇİN)',
  target_month: 'Hedef ay',
  assigned_to: 'Tasarımcı',
}

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
      loadProjectAssignees(getPool(), project),
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
    const {
      title, type, target_month, subtasks = [], pass_kind,
      // SPA sends `assignees` as an array (multi-designer UI). We persist the
      // first as `projects.assigned_to` (the column the rest of the schema
      // and the My Projects filter still rely on) — every additional assignee
      // becomes a per-subtask `assigned_to` via `subtaskAssignees`.
      assigned_to, assignees = [], subtaskAssignees = {},
    } = request.body
    const primaryAssignee = assigned_to ?? (Array.isArray(assignees) && assignees[0]) ?? null
    const result = await withTx(async (client) => {
      const project = await insertProject(client, {
        title, type, target_month, pass_kind, assigned_to: primaryAssignee,
        created_by: request.user.id,
      })
      const subRows = []
      for (const s of subtasks) {
        // Look up the per-subtask override by either the SPA's library key
        // (e.g. "kapak") or — for custom ad-hoc subtasks — by the title the
        // team leader just typed. Falls back to the project primary so the
        // assignment is never silently empty.
        const subAssignee =
          subtaskAssignees?.[s.title] ??
          subtaskAssignees?.[s.key] ??
          primaryAssignee
        const { rows } = await client.query(
          `INSERT INTO subtasks (project_id, title, kind, total_pages, total_stickers, assigned_to)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [project.id, s.title, s.kind ?? 'check', s.total_pages ?? null, s.total_stickers ?? null, subAssignee],
        )
        subRows.push(rows[0])
      }
      const progress = subtaskProgress(subRows)
      const updated = await patchProject(client, project.id, { progress })
      await logHistory(
        client,
        {
          project_id: project.id,
          from_stage: null,
          to_stage: 'tasarim',
          action: 'create',
          event: 'project_created',
          note: 'Proje oluşturuldu',
        },
        request.user,
      )
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
      // Snapshot the project BEFORE the patch so we can describe what
      // changed. For `assigned_to` we resolve the user id to a name so
      // the timeline reads "Tasarımcı değiştirildi → Aylin" instead of
      // the raw id.
      const before = await getProjectForUpdate(client, request.params.id)
      if (!before) notFound('Proje bulunamadı.')
      const updated = await patchProject(client, request.params.id, fields)
      if (!updated) notFound('Proje bulunamadı.')
      // Build a per-field diff description. Only the columns with a
      // human label are tracked; everything else (version, progress,
      // last_reject_reason, …) is bookkeeping that doesn't belong in
      // a user-facing timeline.
      const changes = []
      for (const [key, label] of Object.entries(PROJECT_FIELD_LABELS)) {
        if (!Object.prototype.hasOwnProperty.call(fields, key)) continue
        const oldVal = before[key]
        const newVal = updated[key]
        if (oldVal === newVal) continue
        if (key === 'assigned_to') {
          const { rows: u } = await client.query(
            'SELECT name FROM users WHERE id = $1', [newVal],
          )
          changes.push(`${label} → ${u[0]?.name ?? 'atanmadı'}`)
        } else {
          changes.push(`${label} → ${newVal ?? '—'}`)
        }
      }
      if (changes.length > 0) {
        await logHistory(
          client,
          {
            project_id: updated.id,
            from_stage: updated.stage,
            to_stage: updated.stage,
            action: 'system',
            event: 'project_edit',
            note: changes.join(' · '),
          },
          request.user,
        )
      }
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
      // stage + version are always written. demo_attempt is bumped by the
      // "send a second demo" branch (held → demo_teslim) so the 'Demo N'
      // badge reflects the second cycle. demo_held* are written only when
      // the transition actually flips them.
      const fields = { stage: next.stage, version: next.version }
      if (Object.prototype.hasOwnProperty.call(next, 'demo_attempt')) {
        fields.demo_attempt = next.demo_attempt
      }
      if (Object.prototype.hasOwnProperty.call(next, 'demo_held')) {
        fields.demo_held = next.demo_held
      }
      if (Object.prototype.hasOwnProperty.call(next, 'demo_held_at')) {
        fields.demo_held_at = next.demo_held_at
      }
      if (Object.prototype.hasOwnProperty.call(next, 'demo_held_by_name')) {
        fields.demo_held_by_name = next.demo_held_by_name
      }
      const updated = await patchProject(client, project.id, fields)
      if (history) await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
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
      // optimistic-lock version, AND-rule flags for ozalit_onay, AND the
      // demo_held* trio set by the demo "approve-but-stay" branch).
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
      if (Object.prototype.hasOwnProperty.call(next, 'demo_held')) {
        fields.demo_held = next.demo_held
      }
      if (Object.prototype.hasOwnProperty.call(next, 'demo_held_at')) {
        fields.demo_held_at = next.demo_held_at
      }
      if (Object.prototype.hasOwnProperty.call(next, 'demo_held_by_name')) {
        fields.demo_held_by_name = next.demo_held_by_name
      }
      const updated = await patchProject(client, project.id, fields)
      if (history) await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
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
      await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
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
// (legacy helper — kept here only so an unlikely direct import still
// resolves. Use loadProjectAssignees from the repository instead.)
