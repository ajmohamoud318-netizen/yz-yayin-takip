import { attachUser, requireRole } from '../middleware/auth.js'
import { badRequest, notFound } from '../domain/errors.js'
import { withTx, getPool } from '../db/pool.js'
import {
  listProjects, getProject, getProjectForUpdate,
  listProjectSubtasks, listProjectHistory,
  loadProjectAssignees,
  patchProject, deleteProject, insertProject, logHistory,
  listDeletedProjects, restoreProject,
} from '../services/project-repository.js'
import { schemas } from '../schemas/index.js'
import { subtaskProgress } from '../domain/progress.js'
import {
  applyAdvance, applyApproval, applyDemoReceive, applyDemoNotReceived,
  applyOzalitNotReceived, applyRejection,
} from '../services/project-transitions.js'
import { notifyProjectCreated, notifyProjectTransition, notifyProjectDeleted } from '../services/notifications.js'

/**
 * Projects + stage transition API.
 *
 * GET    /api/projects
 * GET    /api/projects/:id           — returns project + subtasks + history
 * POST   /api/projects
 * PATCH  /api/projects/:id
 * DELETE /api/projects/:id           — soft delete (team_leader only)
 * GET    /api/projects/deleted       — list soft-deleted projects (team_leader only)
 * POST   /api/projects/:id/restore   — undo a soft delete (team_leader only)
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

  fastify.get('/projects/deleted', async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    return listDeletedProjects()
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
      for (const [index, s] of subtasks.entries()) {
        // Look up the per-subtask override by either the SPA's library key
        // (e.g. "kapak") or — for custom ad-hoc subtasks — by the title the
        // team leader just typed. Falls back to the project primary so the
        // assignment is never silently empty.
        const subAssignee =
          subtaskAssignees?.[s.title] ??
          subtaskAssignees?.[s.key] ??
          primaryAssignee
        // `position` stamps the order the leader chose at creation time
        // (migration 027) rather than leaving it to created_at ties.
        const { rows } = await client.query(
          `INSERT INTO subtasks (project_id, title, kind, total_pages, total_stickers, assigned_to, position)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [project.id, s.title, s.kind ?? 'check', s.total_pages ?? null, s.total_stickers ?? null, subAssignee, index],
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
      // Notify the assigned designer(s). Subtasks were just inserted in this
      // same tx, so loadProjectAssignees (called inside the helper) sees them.
      await notifyProjectCreated(client, { project: updated, actor: request.user })
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
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      const assignees = await loadProjectAssignees(client, project)
      await deleteProject(client, project.id, request.user)
      await notifyProjectDeleted(client, { project, actor: request.user, assignees })
      return { ok: true }
    })
    return result
  })

  fastify.post('/projects/:id/restore', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const restored = await restoreProject(request.params.id)
    if (!restored) notFound('Silinmiş proje bulunamadı.')
    return restored
  })

  fastify.post('/projects/:id/advance', { schema: schemas.projectsAdvance }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      // Hydrate assignees: the demo re-send branch in computeAdvance gates on
      // "team_leader OR assigned designer" via project.assignees. getProjectForUpdate
      // doesn't populate that array, so without this the assigned-designer check
      // always fails and the designer's "Demo İste" 400s — even though the SPA
      // (which has assignees loaded) shows them the button. Load it so the API
      // matches the frontend's gate. See ProjectDetail.jsx isAssignedDesigner.
      project.assignees = await loadProjectAssignees(client, project)
      // Subtasks feed the resubmit gate: a Tasarım resubmit is blocked while
      // any subtask still needs revision (see computeAdvance).
      project.subtasks = await listProjectSubtasks(client, project.id)
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
      // Who/when the matbaa delivered the current demo round — set by the
      // printer's delivery step, nulled when a second demo is sent.
      if (Object.prototype.hasOwnProperty.call(next, 'demo_delivered_at')) {
        fields.demo_delivered_at = next.demo_delivered_at
      }
      if (Object.prototype.hasOwnProperty.call(next, 'demo_delivered_by')) {
        fields.demo_delivered_by = next.demo_delivered_by
      }
      if (Object.prototype.hasOwnProperty.call(next, 'demo_delivered_by_name')) {
        fields.demo_delivered_by_name = next.demo_delivered_by_name
      }
      // The ozalit_teslim two-step (request → matbaa deliver) and the
      // reject-to-matbaa lock live on these flags. Without persisting them the
      // "Ozalit İste" request set ozalit_requested=true in memory only and it
      // vanished — the matbaa never saw a pending ozalit and the button stayed.
      if (Object.prototype.hasOwnProperty.call(next, 'ozalit_requested')) {
        fields.ozalit_requested = next.ozalit_requested
      }
      if (Object.prototype.hasOwnProperty.call(next, 'reject_target')) {
        fields.reject_target = next.reject_target
      }
      // Cleared to null when an ozalit-revision resubmit leaves Tasarım.
      if (Object.prototype.hasOwnProperty.call(next, 'last_reject_type')) {
        fields.last_reject_type = next.last_reject_type
      }
      if (Object.prototype.hasOwnProperty.call(next, 'last_reject_target')) {
        fields.last_reject_target = next.last_reject_target
      }
      const updated = await patchProject(client, project.id, fields)
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyProjectTransition(client, {
          project: updated, fromStage: history.from_stage, toStage: history.to_stage ?? updated.stage,
          action: history.action, actor: request.user, assignees: project.assignees,
        })
      }
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
      // Multi-party ozalit approval needs the full required set: every active
      // team leader + every assigned designer. Load both so the transition can
      // record this approval and advance only once everyone has signed off.
      project.assignees = await loadProjectAssignees(client, project)
      const designerIds = project.assignees.map((a) => a.id)
      const { rows: leaderRows } = await client.query(
        "SELECT id FROM users WHERE role = 'team_leader' AND is_active = TRUE",
      )
      const teamLeaderIds = leaderRows.map((r) => r.id)
      const { project: next, history } = applyApproval(project, {
        user: request.user, stage, note: note ?? '', teamLeaderIds, designerIds,
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
      if (Object.prototype.hasOwnProperty.call(next, 'ozalit_approvals')) {
        fields.ozalit_approvals = JSON.stringify(next.ozalit_approvals)
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
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyProjectTransition(client, {
          project: updated, fromStage: history.from_stage, toStage: history.to_stage ?? updated.stage,
          action: history.action, actor: request.user, assignees: project.assignees,
        })
      }
      return updated
    })
    return result
  })

  // Mark a delivered demo "Teslim Alındı" (received) — the gate before Onay.
  // Allowed for the team leader or an assigned designer, only at demo_onay /
  // cin_demo_onay.
  fastify.post('/projects/:id/receive', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      project.assignees = await loadProjectAssignees(client, project)
      const designerIds = project.assignees.map((a) => a.id)
      const { project: next, history } = applyDemoReceive(project, { user: request.user, designerIds })
      const updated = await patchProject(client, project.id, {
        demo_received: next.demo_received,
        demo_received_by: next.demo_received_by ?? null,
        demo_received_at: next.demo_received_at ?? null,
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
      }
      return updated
    })
    return result
  })

  // Report that a delivered demo never actually reached the leader/designer —
  // sends it back to the matbaa's teslim stage for redelivery. Counterpart to
  // /receive; only valid before demo_received is set.
  fastify.post('/projects/:id/demo-not-received', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      project.assignees = await loadProjectAssignees(client, project)
      const designerIds = project.assignees.map((a) => a.id)
      const { project: next, history } = applyDemoNotReceived(project, { user: request.user, designerIds })
      const updated = await patchProject(client, project.id, {
        stage: next.stage,
        demo_attempt: next.demo_attempt,
        demo_held: next.demo_held,
        demo_held_at: next.demo_held_at,
        demo_held_by_name: next.demo_held_by_name,
        demo_received: next.demo_received,
        demo_received_by: next.demo_received_by,
        demo_received_at: next.demo_received_at,
        demo_delivered_at: next.demo_delivered_at,
        demo_delivered_by: next.demo_delivered_by,
        demo_delivered_by_name: next.demo_delivered_by_name,
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyProjectTransition(client, {
          project: updated, fromStage: history.from_stage, toStage: history.to_stage ?? updated.stage,
          action: history.action, actor: request.user, assignees: project.assignees,
        })
      }
      return updated
    })
    return result
  })

  // Report that a delivered ozalit never actually reached the leader/designer
  // — sends it back to ozalit_teslim with the matbaa re-delivery lock, wiping
  // any partial approval ledger (a new physical proof needs fresh sign-off).
  fastify.post('/projects/:id/ozalit-not-received', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      project.assignees = await loadProjectAssignees(client, project)
      const designerIds = project.assignees.map((a) => a.id)
      const { project: next, history } = applyOzalitNotReceived(project, { user: request.user, designerIds })
      const updated = await patchProject(client, project.id, {
        stage: next.stage,
        ozalit_attempt: next.ozalit_attempt,
        ozalit_requested: next.ozalit_requested,
        reject_target: next.reject_target,
        ozalit_leader_approved: next.ozalit_leader_approved,
        ozalit_leader_approved_by: next.ozalit_leader_approved_by,
        ozalit_leader_approved_at: next.ozalit_leader_approved_at,
        ozalit_designer_approvals: JSON.stringify(next.ozalit_designer_approvals ?? []),
        ozalit_approvals: JSON.stringify(next.ozalit_approvals ?? []),
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyProjectTransition(client, {
          project: updated, fromStage: history.from_stage, toStage: history.to_stage ?? updated.stage,
          action: history.action, actor: request.user, assignees: project.assignees,
        })
      }
      return updated
    })
    return result
  })

  fastify.post('/projects/:id/reject', { schema: schemas.projectsReject }, async (request) => {
    await attachUser(request)
    const { stage, reason, reject_target: rejectTarget, revizeIds, note } = request.body
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      // Load subtasks so computeRejection can reset exactly the leader-selected
      // ones (revizeIds) and recompute progress on a reject-to-designer. Without
      // this the transition operates on an empty subtask list and the revise
      // selection has nothing to act on.
      project.subtasks = await listProjectSubtasks(client, project.id)
      const { project: next, history } = applyRejection(project, {
        user: request.user, stage, reason, rejectTarget, revizeIds, note,
      })
      const projectFields = {
        stage: next.stage,
        demo_attempt: next.demo_attempt,
        ozalit_attempt: next.ozalit_attempt,
        last_reject_reason: next.last_reject_reason,
        version: next.version,
        // reject-to-matbaa sets reject_target='matbaa' (the re-delivery lock);
        // every reject clears ozalit_requested. Persist both so the state sticks.
        reject_target: next.reject_target,
        ozalit_requested: next.ozalit_requested,
        // last_reject_type routes the designer's resubmit (ozalit → ozalit_teslim
        // vs demo → demo_teslim) and labels the button; persist it + its target.
        last_reject_type: next.last_reject_type,
        last_reject_target: next.last_reject_target,
        // An ozalit rejection wipes the multi-party approval ledger.
        ozalit_approvals: JSON.stringify(next.ozalit_approvals ?? []),
      }
      // Reject-to-designer recomputes progress from the reopened subtasks;
      // reject-to-matbaa leaves subtasks (and progress) untouched.
      if (typeof next.progress === 'number') projectFields.progress = next.progress
      const updated = await patchProject(client, project.id, projectFields)
      // Persist the subtask resets from the revise selection. The matbaa route
      // returns no `subtasks`, so those rows are left as-is.
      if (Array.isArray(next.subtasks)) {
        for (const s of next.subtasks) {
          await client.query(
            `UPDATE subtasks
                SET is_done = $2, done_at = $3, pages_done = $4, needs_revize = $5, updated_at = NOW()
              WHERE id = $1`,
            [s.id, !!s.is_done, s.done_at ?? null, s.pages_done ?? null, !!s.needs_revize],
          )
        }
      }
      await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
      // Rejection → designers must rework. assignees aren't preloaded on this
      // route (only subtasks are), so the helper resolves them itself.
      await notifyProjectTransition(client, {
        project: updated, fromStage: history.from_stage, toStage: history.to_stage ?? updated.stage,
        action: history.action ?? 'reject', actor: request.user,
      })
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
