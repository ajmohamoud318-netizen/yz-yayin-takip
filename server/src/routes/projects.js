import { attachUser, requireRole } from '../middleware/auth.js'
import { badRequest, notFound } from '../domain/errors.js'
import { withTx, getPool } from '../db/pool.js'
import {
  listProjects, getProject, getProjectForUpdate, getProjectIncludingDeleted,
  listProjectSubtasks, listProjectHistory,
  loadProjectAssignees,
  patchProject, deleteProject, insertProject, logHistory,
  listDeletedProjects, restoreProject, setProjectCatalogHidden,
} from '../services/project-repository.js'
import { schemas } from '../schemas/index.js'
import { subtaskProgress } from '../domain/progress.js'
import {
  applyAdvance, applyApproval, applyDemoReceive, applyDemoNotReceived,
  applyOzalitReceive, applyOzalitNotReceived, applyBaskiOnayPrepare, applyRejection,
  applyDemoStart, applyOzalitStart, applyDemoCancel, applyOzalitCancel,
  applyDemoEdit, applyOzalitEdit,
  applyDemoChangeRequest, applyOzalitChangeRequest,
  applyDemoChangeAccept, applyDemoChangeDecline, applyOzalitChangeAccept, applyOzalitChangeDecline,
  applyEkranDemoRequest, applyEkranDemoApprove, applyEkranDemoReject,
} from '../services/project-transitions.js'
import {
  notifyProjectCreated, notifyProjectTransition, notifyProjectDeleted,
  notifyProductCatalogChanged, notifyDemoReceived, notifyOzalitReceived,
  notifyBaskiOnayPrepared,
  notifyDemoStarted, notifyOzalitStarted, notifyDemoCancelled, notifyOzalitCancelled,
  notifyDemoEdited, notifyOzalitEdited,
  notifyDemoChangeRequested, notifyOzalitChangeRequested,
  notifyDemoChangeAccepted, notifyDemoChangeDeclined,
  notifyOzalitChangeAccepted, notifyOzalitChangeDeclined,
  notifyEkranDemoRequested, notifyEkranDemoRejected,
} from '../services/notifications.js'
import { ORDERABLE_STAGES } from '../domain/stages.js'
// Blocks main-pipeline transitions on imported backlist products — see the
// helper's own docblock for why this is destructive rather than just useless.
import { assertNotLegacy } from '../domain/pipeline.js'
import { captureProductInfoFromSpec, captureHistoryNote } from '../services/product-info-capture.js'

/**
 * Projects + stage transition API.
 *
 * GET    /api/projects
 * GET    /api/projects/:id           — returns project + subtasks + history
 * POST   /api/projects
 * POST   /api/projects/import        — legacy/backlist products (team_leader only)
 * PATCH  /api/projects/:id
 * DELETE /api/projects/:id           — soft delete (team_leader only)
 * GET    /api/projects/deleted       — list soft-deleted projects (team_leader only)
 * POST   /api/projects/:id/restore   — undo a soft delete (team_leader only)
 * POST   /api/projects/:id/catalog   — kaldır / geri al in Ürünler (team_leader only)
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
    // Unfiltered read: a deleted project should still open (read-only) —
    // e.g. from the "project deleted" notification — instead of just
    // 404ing on whoever had it open. Every mutation route below still
    // uses getProject/getProjectForUpdate, which DO filter, so nothing
    // can actually be changed on it while it's deleted.
    const project = await getProjectIncludingDeleted(request.params.id)
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

  /**
   * Legacy/backlist import — see AGENTS.md → "Kayıtlı ürünler (legacy)".
   *
   * Creates projects that already sit at a finished stage, so books published
   * before this system existed can appear in the Ürünler catalog and Sales can
   * raise a sipariş against them. Deliberately a separate route from
   * `POST /projects` so the normal create path keeps its "every project starts
   * at Tasarım" invariant.
   *
   * The whole batch runs in ONE transaction: a half-imported catalog is worse
   * than a rejected file, and `dryRun` relies on being able to roll back after
   * doing every real check.
   */
  fastify.post('/projects/import', { schema: schemas.projectsImport }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const { items, dryRun = false } = request.body

    // Duplicate detection is on normalised title (case-insensitive, collapsed
    // whitespace) against live projects AND within the batch itself. We report
    // rather than merge: a collision between a live project and a backlist entry
    // is a human decision, not something to guess at.
    const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR')

    const result = await withTx(async (client) => {
      const { rows: existingRows } = await client.query(
        'SELECT id, title FROM projects WHERE deleted_at IS NULL',
      )
      const existingTitles = new Map(existingRows.map((r) => [norm(r.title), r.title]))
      const existingIds = new Set(existingRows.map((r) => r.id))

      const created = []
      const duplicates = []
      const errors = []
      const seenInBatch = new Set()
      let missingProductInfo = 0

      for (const [index, item] of items.entries()) {
        const key = norm(item.title)
        if (!key) {
          errors.push({ row: index + 1, message: 'Kitap adı boş.' })
          continue
        }
        // An id already taken means this seed was promoted before — a 409 for a
        // single item, but in a batch it's just "already done", so report it as
        // a duplicate instead of failing the whole import.
        if (item.id && existingIds.has(item.id)) {
          duplicates.push(item.title)
          continue
        }
        if (existingTitles.has(key) || seenInBatch.has(key)) {
          duplicates.push(item.title)
          continue
        }
        seenInBatch.add(key)

        const components = Array.isArray(item.components) ? item.components : []
        if (components.length === 0) missingProductInfo += 1

        const stage = item.stage ?? 'satista'
        // Belt-and-braces: the schema already restricts the enum, but this is
        // the invariant that keeps a legacy row out of the live pipeline, so
        // assert it here too rather than trusting one layer.
        if (!ORDERABLE_STAGES.has(stage)) {
          badRequest(`Kayıtlı ürün yalnızca üretime hazır ve sonrası aşamalara aktarılabilir (satır ${index + 1}).`)
        }

        const project = await insertProject(client, {
          id: item.id,
          title: item.title,
          type: item.type,
          stage,
          // Finished books are 100% done by definition. At 0% they'd render as
          // red/overdue cards and trip the STAGES_REQUIRING_FULL_PROGRESS gate.
          progress: 100,
          // The pass this book is currently in was its (untracked) first
          // edition; it becomes a 'reprint' when Sales orders it.
          pass_kind: item.pass_kind ?? 'first_edition',
          target_month: item.target_month ?? null,
          assigned_to: null,
          origin: 'legacy',
          created_by: request.user.id,
        })

        if (components.length > 0) {
          await client.query(
            `INSERT INTO product_info (project_id, components, updated_by, updated_at)
             VALUES ($1, $2::jsonb, $3, NOW())
             ON CONFLICT (project_id)
             DO UPDATE SET components = EXCLUDED.components,
                           updated_by = EXCLUDED.updated_by,
                           updated_at = NOW()`,
            [project.id, JSON.stringify(components), request.user.id],
          )
        }

        await logHistory(
          client,
          {
            project_id: project.id,
            from_stage: null,
            to_stage: stage,
            action: 'create',
            event: 'legacy_import',
            note: 'Kayıttan ürün olarak eklendi',
          },
          request.user,
        )

        existingIds.add(project.id)
        existingTitles.set(key, item.title)
        created.push(project)
      }

      const summary = {
        willCreate: created.length,
        duplicates,
        missingProductInfo,
        errors,
        dryRun,
      }

      // Deliberately NOT calling notifyProjectCreated: it fans out to
      // assignees, and a legacy row has none — across a 90-item batch it would
      // be a notification flood for no reader.

      if (dryRun) {
        // Undo everything we just wrote; the caller only wanted the counts.
        // Throwing is how withTx rolls back, so carry the summary on the error
        // and unwrap it outside.
        const rollback = new Error('dry-run')
        rollback.__dryRunSummary = summary
        throw rollback
      }
      return { ...summary, created }
    }).catch((e) => {
      if (e && e.__dryRunSummary) return { ...e.__dryRunSummary, created: [] }
      throw e
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

  /**
   * "Kaldır" / "Geri Al" — take a product out of the Ürünler catalog, or put
   * it back (migration 033).
   *
   * Deliberately separate from DELETE /projects/:id: a discontinued or
   * out-of-print book is still a real project with real history, so soft-
   * deleting it to stop Sales ordering it would also strip it from every
   * pipeline view and the timeline. This flips one flag and nothing else.
   *
   * team_leader only — same owner as the rest of the catalog's data integrity
   * (Ürün Bilgileri, kayıt imports).
   */
  fastify.post('/projects/:id/catalog', { schema: schemas.projectsCatalog }, async (request) => {
    await attachUser(request)
    requireRole(request, 'team_leader')
    const hidden = request.body.hidden
    const note = request.body.note?.trim() || ''

    await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      // Only orderable-stage projects are in the catalog at all, so hiding
      // anything earlier would be a no-op flag the leader could never see or
      // undo from the Ürünler page.
      if (hidden && !ORDERABLE_STAGES.has(project.stage)) {
        badRequest('Yalnızca katalogdaki (üretime hazır ve sonrası) ürünler kaldırılabilir.')
      }
      // Idempotent: re-sending the same state is a no-op rather than a second
      // history row + notification for a change that didn't happen.
      if (!!project.catalog_hidden === hidden) return

      await setProjectCatalogHidden(client, project.id, hidden, request.user)
      await logHistory(client, {
        project_id: project.id,
        action: 'system',
        event: hidden ? 'catalog_delist' : 'catalog_relist',
        from_stage: project.stage,
        to_stage: project.stage,
        pass_number: project.pass_number ?? 1,
        note: note || (hidden ? 'Ürün katalogdan kaldırıldı.' : 'Ürün katalogda tekrar yayında.'),
      }, request.user)
      await notifyProductCatalogChanged(client, { project, actor: request.user, hidden })
    })

    // Re-read outside the tx: `setProjectCatalogHidden` returns the raw column
    // set, which has no `has_product_info` — the Ürünler row needs it to decide
    // between the "Sipariş" action and the "ürün bilgisi eksik" warning.
    return getProject(request.params.id)
  })

  fastify.post('/projects/:id/advance', { schema: schemas.projectsAdvance }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
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
      // The receipt gates. Both are cleared by the matbaa's delivery step
      // (computeDemoTeslimAdvance / computeOzalitTeslimAdvance) so each round
      // needs its own "Teslim Alındı" — a reset that never reached the DB
      // while these fields weren't in the patch, leaving a re-delivered demo
      // pre-acknowledged from the previous round.
      if (Object.prototype.hasOwnProperty.call(next, 'demo_received')) {
        fields.demo_received = next.demo_received
        fields.demo_received_by = next.demo_received_by ?? null
        fields.demo_received_at = next.demo_received_at ?? null
      }
      if (Object.prototype.hasOwnProperty.call(next, 'ozalit_received')) {
        fields.ozalit_received = next.ozalit_received
        fields.ozalit_received_by = next.ozalit_received_by ?? null
        fields.ozalit_received_at = next.ozalit_received_at ?? null
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
      // Fresh delivery/re-send clears any leftover "fix owed" flag from the
      // round that just ended (migration 049) — see computeDemoTeslimAdvance.
      if (Object.prototype.hasOwnProperty.call(next, 'demo_fix_pending')) {
        fields.demo_fix_pending = next.demo_fix_pending
      }
      if (Object.prototype.hasOwnProperty.call(next, 'ozalit_fix_pending')) {
        fields.ozalit_fix_pending = next.ozalit_fix_pending
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
      assertNotLegacy(project)
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
      // Cleared by the baski_onay approve branch once it actually advances to
      // Üretime Hazır (migration 045's dual-approval pair resets for any
      // hypothetical future round).
      if (Object.prototype.hasOwnProperty.call(next, 'baski_onay_prepared')) {
        fields.baski_onay_prepared = next.baski_onay_prepared
      }
      if (Object.prototype.hasOwnProperty.call(next, 'baski_onay_prepared_by')) {
        fields.baski_onay_prepared_by = next.baski_onay_prepared_by
      }
      if (Object.prototype.hasOwnProperty.call(next, 'baski_onay_prepared_by_name')) {
        fields.baski_onay_prepared_by_name = next.baski_onay_prepared_by_name
      }
      if (Object.prototype.hasOwnProperty.call(next, 'baski_onay_prepared_at')) {
        fields.baski_onay_prepared_at = next.baski_onay_prepared_at
      }
      const updated = await patchProject(client, project.id, fields)
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyProjectTransition(client, {
          project: updated, fromStage: history.from_stage, toStage: history.to_stage ?? updated.stage,
          action: history.action, actor: request.user, assignees: project.assignees,
        })
      }
      // Entering production is the point the spec stops changing, so the
      // approved baski_onay/cin_baski_onay (fallback: ozalit/demo) sheet is
      // copied into Ürün Bilgileri here. Without it a project can reach
      // Baskıda with a fully signed sheet and still have no spec, which
      // blocks Sales from ordering it at all. Guarded on an actual stage
      // CHANGE so re-approving an already production-ready project doesn't
      // re-run the capture.
      if (updated.stage === 'baskida' && project.stage !== 'baskida') {
        const captured = await captureProductInfoFromSpec(client, { project: updated, actor: request.user })
        if (captured) {
          await logHistory(
            client,
            {
              project_id: project.id,
              from_stage: updated.stage,
              to_stage: updated.stage,
              action: 'system',
              event: 'product_info_auto',
              note: captureHistoryNote([...captured.added, ...captured.updated]),
            },
            request.user,
          )
        }
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
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const designerIds = project.assignees.map((a) => a.id)
      const { project: next, history } = applyDemoReceive(project, { user: request.user, designerIds })
      const updated = await patchProject(client, project.id, {
        demo_received: next.demo_received,
        demo_received_by: next.demo_received_by ?? null,
        demo_received_at: next.demo_received_at ?? null,
      })
      // `history` is null when the demo was already acknowledged (receive is
      // idempotent) — no second round of pings for a repeat click.
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyDemoReceived(client, {
          project: updated, actor: request.user, assignees: project.assignees,
        })
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
      assertNotLegacy(project)
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
        demo_fix_pending: next.demo_fix_pending,
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

  // Mark a delivered ozalit "Teslim Alındı" (received) — the gate before the
  // multi-party Ozalit Onayı. Allowed for the team leader or an assigned
  // designer, only at ozalit_onay. Twin of /receive (migration 035).
  fastify.post('/projects/:id/ozalit-receive', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const designerIds = project.assignees.map((a) => a.id)
      const { project: next, history } = applyOzalitReceive(project, { user: request.user, designerIds })
      const updated = await patchProject(client, project.id, {
        ozalit_received: next.ozalit_received,
        ozalit_received_by: next.ozalit_received_by ?? null,
        ozalit_received_at: next.ozalit_received_at ?? null,
      })
      // `history` is null when the ozalit was already acknowledged (receive is
      // idempotent) — no second round of pings for a repeat click.
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyOzalitReceived(client, {
          project: updated, actor: request.user, assignees: project.assignees,
        })
      }
      return updated
    })
    return result
  })

  // Report that a delivered ozalit never actually reached the leader/designer
  // — sends it back to ozalit_teslim with the matbaa re-delivery lock, wiping
  // any partial approval ledger (a new physical proof needs fresh sign-off).
  // Counterpart to /ozalit-receive; only valid before ozalit_received is set.
  fastify.post('/projects/:id/ozalit-not-received', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const designerIds = project.assignees.map((a) => a.id)
      const { project: next, history } = applyOzalitNotReceived(project, { user: request.user, designerIds })
      const updated = await patchProject(client, project.id, {
        stage: next.stage,
        ozalit_attempt: next.ozalit_attempt,
        ozalit_requested: next.ozalit_requested,
        ozalit_received: next.ozalit_received,
        ozalit_received_by: next.ozalit_received_by,
        ozalit_received_at: next.ozalit_received_at,
        reject_target: next.reject_target,
        ozalit_leader_approved: next.ozalit_leader_approved,
        ozalit_leader_approved_by: next.ozalit_leader_approved_by,
        ozalit_leader_approved_at: next.ozalit_leader_approved_at,
        ozalit_designer_approvals: JSON.stringify(next.ozalit_designer_approvals ?? []),
        ozalit_approvals: JSON.stringify(next.ozalit_approvals ?? []),
        ozalit_fix_pending: next.ozalit_fix_pending,
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

  // Mark the Baskı Onay Formu "hazırlandı" — the maker half of migration
  // 045's dual-approval pair. Any active team leader may prepare it; the
  // later approve (computeApproval's baski_onay branch) then requires a
  // DIFFERENT team leader, unless the preparer is the only one there is.
  fastify.post('/projects/:id/baski-onay-prepare', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      const { project: next, history } = applyBaskiOnayPrepare(project, { user: request.user })
      const updated = await patchProject(client, project.id, {
        baski_onay_prepared: next.baski_onay_prepared,
        baski_onay_prepared_by: next.baski_onay_prepared_by,
        baski_onay_prepared_by_name: next.baski_onay_prepared_by_name,
        baski_onay_prepared_at: next.baski_onay_prepared_at,
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        const { rows: leaderRows } = await client.query(
          "SELECT id FROM users WHERE role = 'team_leader' AND is_active = TRUE",
        )
        await notifyBaskiOnayPrepared(client, {
          project: updated, actor: request.user, teamLeaderIds: leaderRows.map((r) => r.id),
        })
      }
      return updated
    })
    return result
  })

  // Matbaa marks they've begun physical work on the demo — flag-only, no
  // stage change. Once set, a cancel/edit from the leader/designer needs
  // the matbaa's OK via the change-request routes below.
  fastify.post('/projects/:id/demo-start', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const { project: next, history } = applyDemoStart(project, { user: request.user })
      const updated = await patchProject(client, project.id, {
        demo_started: next.demo_started,
        demo_started_at: next.demo_started_at,
        demo_started_by: next.demo_started_by,
        demo_started_by_name: next.demo_started_by_name,
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyDemoStarted(client, { project: updated, actor: request.user, assignees: project.assignees })
      }
      return updated
    })
    return result
  })

  fastify.post('/projects/:id/ozalit-start', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const { project: next, history } = applyOzalitStart(project, { user: request.user })
      const updated = await patchProject(client, project.id, {
        ozalit_started: next.ozalit_started,
        ozalit_started_at: next.ozalit_started_at,
        ozalit_started_by: next.ozalit_started_by,
        ozalit_started_by_name: next.ozalit_started_by_name,
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyOzalitStarted(client, { project: updated, actor: request.user, assignees: project.assignees })
      }
      return updated
    })
    return result
  })

  // Cancel a mistaken demo/ozalit request outright — back to tasarim,
  // deliberately NOT bumping demo_attempt/ozalit_attempt (nothing was
  // delivered). Only valid before the matbaa has started; see
  // computeDemoCancel/computeOzalitCancel for the guard.
  fastify.post('/projects/:id/demo-cancel', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const designerIds = project.assignees.map((a) => a.id)
      const { project: next, history } = applyDemoCancel(project, { user: request.user, designerIds })
      const updated = await patchProject(client, project.id, {
        stage: next.stage,
        demo_held: next.demo_held,
        demo_held_at: next.demo_held_at,
        demo_held_by_name: next.demo_held_by_name,
        demo_delivered_at: next.demo_delivered_at,
        demo_delivered_by: next.demo_delivered_by,
        demo_delivered_by_name: next.demo_delivered_by_name,
        demo_received: next.demo_received,
        demo_received_by: next.demo_received_by,
        demo_received_at: next.demo_received_at,
        demo_started: next.demo_started,
        demo_started_at: next.demo_started_at,
        demo_started_by: next.demo_started_by,
        demo_started_by_name: next.demo_started_by_name,
        demo_change_requested_at: next.demo_change_requested_at,
        demo_change_requested_by: next.demo_change_requested_by,
        demo_change_requested_by_name: next.demo_change_requested_by_name,
        demo_change_requested_note: next.demo_change_requested_note,
        demo_fix_pending: next.demo_fix_pending,
        reject_target: next.reject_target,
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyDemoCancelled(client, { project: updated, actor: request.user })
      }
      return updated
    })
    return result
  })

  fastify.post('/projects/:id/ozalit-cancel', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const designerIds = project.assignees.map((a) => a.id)
      const { project: next, history } = applyOzalitCancel(project, { user: request.user, designerIds })
      const updated = await patchProject(client, project.id, {
        stage: next.stage,
        ozalit_requested: next.ozalit_requested,
        ozalit_received: next.ozalit_received,
        ozalit_received_by: next.ozalit_received_by,
        ozalit_received_at: next.ozalit_received_at,
        ozalit_started: next.ozalit_started,
        ozalit_started_at: next.ozalit_started_at,
        ozalit_started_by: next.ozalit_started_by,
        ozalit_started_by_name: next.ozalit_started_by_name,
        ozalit_change_requested_at: next.ozalit_change_requested_at,
        ozalit_change_requested_by: next.ozalit_change_requested_by,
        ozalit_change_requested_by_name: next.ozalit_change_requested_by_name,
        ozalit_change_requested_note: next.ozalit_change_requested_note,
        ozalit_fix_pending: next.ozalit_fix_pending,
        reject_target: next.reject_target,
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyOzalitCancelled(client, { project: updated, actor: request.user })
      }
      return updated
    })
    return result
  })

  // Leader/assigned designer edited the saved demo/ozalit form (SpecFormDialog
  // mode='view') while it's still with the matbaa and wants them notified.
  // Same free-edit window as demo-cancel/ozalit-cancel — refused once the
  // matbaa has started (computeDemoEdit/computeOzalitEdit). Also the one
  // place that clears demo_fix_pending/ozalit_fix_pending when an accepted
  // change request owed a fix — this submission IS the fix (migration 049).
  fastify.post('/projects/:id/demo-edit-notify', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const designerIds = project.assignees.map((a) => a.id)
      const { project: next, history } = applyDemoEdit(project, { user: request.user, designerIds })
      const updated = await patchProject(client, project.id, {
        demo_fix_pending: next.demo_fix_pending,
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyDemoEdited(client, { project: updated, actor: request.user })
      }
      return updated
    })
    return result
  })

  fastify.post('/projects/:id/ozalit-edit-notify', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const designerIds = project.assignees.map((a) => a.id)
      const { project: next, history } = applyOzalitEdit(project, { user: request.user, designerIds })
      const updated = await patchProject(client, project.id, {
        ozalit_fix_pending: next.ozalit_fix_pending,
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyOzalitEdited(client, { project: updated, actor: request.user })
      }
      return updated
    })
    return result
  })

  // Leader/assigned designer asks the matbaa to accept a cancel/edit — only
  // valid once the matbaa has started (computeDemoChangeRequest guards this).
  fastify.post('/projects/:id/demo-change-request', { schema: schemas.projectsChangeRequest }, async (request) => {
    await attachUser(request)
    const { note } = request.body ?? {}
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const designerIds = project.assignees.map((a) => a.id)
      const { project: next, history } = applyDemoChangeRequest(project, { user: request.user, designerIds, note })
      const updated = await patchProject(client, project.id, {
        demo_change_requested_at: next.demo_change_requested_at,
        demo_change_requested_by: next.demo_change_requested_by,
        demo_change_requested_by_name: next.demo_change_requested_by_name,
        demo_change_requested_note: next.demo_change_requested_note,
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyDemoChangeRequested(client, { project: updated, actor: request.user, note: next.demo_change_requested_note })
      }
      return updated
    })
    return result
  })

  fastify.post('/projects/:id/ozalit-change-request', { schema: schemas.projectsChangeRequest }, async (request) => {
    await attachUser(request)
    const { note } = request.body ?? {}
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const designerIds = project.assignees.map((a) => a.id)
      const { project: next, history } = applyOzalitChangeRequest(project, { user: request.user, designerIds, note })
      const updated = await patchProject(client, project.id, {
        ozalit_change_requested_at: next.ozalit_change_requested_at,
        ozalit_change_requested_by: next.ozalit_change_requested_by,
        ozalit_change_requested_by_name: next.ozalit_change_requested_by_name,
        ozalit_change_requested_note: next.ozalit_change_requested_note,
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyOzalitChangeRequested(client, { project: updated, actor: request.user, note: next.ozalit_change_requested_note })
      }
      return updated
    })
    return result
  })

  // Matbaa's answer to a pending change-request. Accept "un-starts" the
  // round, reopening free cancel/edit; decline leaves it started.
  fastify.post('/projects/:id/demo-change-accept', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const { project: next, history } = applyDemoChangeAccept(project, { user: request.user })
      const updated = await patchProject(client, project.id, {
        demo_started: next.demo_started,
        demo_started_at: next.demo_started_at,
        demo_started_by: next.demo_started_by,
        demo_started_by_name: next.demo_started_by_name,
        demo_change_requested_at: next.demo_change_requested_at,
        demo_change_requested_by: next.demo_change_requested_by,
        demo_change_requested_by_name: next.demo_change_requested_by_name,
        demo_change_requested_note: next.demo_change_requested_note,
        demo_fix_pending: next.demo_fix_pending,
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyDemoChangeAccepted(client, { project: updated, actor: request.user, assignees: project.assignees })
      }
      return updated
    })
    return result
  })

  fastify.post('/projects/:id/demo-change-decline', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const { project: next, history } = applyDemoChangeDecline(project, { user: request.user })
      const updated = await patchProject(client, project.id, {
        demo_change_requested_at: next.demo_change_requested_at,
        demo_change_requested_by: next.demo_change_requested_by,
        demo_change_requested_by_name: next.demo_change_requested_by_name,
        demo_change_requested_note: next.demo_change_requested_note,
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyDemoChangeDeclined(client, { project: updated, actor: request.user, assignees: project.assignees })
      }
      return updated
    })
    return result
  })

  fastify.post('/projects/:id/ozalit-change-accept', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const { project: next, history } = applyOzalitChangeAccept(project, { user: request.user })
      const updated = await patchProject(client, project.id, {
        ozalit_started: next.ozalit_started,
        ozalit_started_at: next.ozalit_started_at,
        ozalit_started_by: next.ozalit_started_by,
        ozalit_started_by_name: next.ozalit_started_by_name,
        ozalit_change_requested_at: next.ozalit_change_requested_at,
        ozalit_change_requested_by: next.ozalit_change_requested_by,
        ozalit_change_requested_by_name: next.ozalit_change_requested_by_name,
        ozalit_change_requested_note: next.ozalit_change_requested_note,
        ozalit_fix_pending: next.ozalit_fix_pending,
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyOzalitChangeAccepted(client, { project: updated, actor: request.user, assignees: project.assignees })
      }
      return updated
    })
    return result
  })

  fastify.post('/projects/:id/ozalit-change-decline', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const { project: next, history } = applyOzalitChangeDecline(project, { user: request.user })
      const updated = await patchProject(client, project.id, {
        ozalit_change_requested_at: next.ozalit_change_requested_at,
        ozalit_change_requested_by: next.ozalit_change_requested_by,
        ozalit_change_requested_by_name: next.ozalit_change_requested_by_name,
        ozalit_change_requested_note: next.ozalit_change_requested_note,
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyOzalitChangeDeclined(client, { project: updated, actor: request.user, assignees: project.assignees })
      }
      return updated
    })
    return result
  })

  // Ekran Demo Onayı — the lightweight digital alternative to a physical
  // re-demo for a held demo (demo_held) once progress reaches 100%. See
  // computeEkranDemoRequest/Approve/Reject and migration 050.
  fastify.post('/projects/:id/ekran-demo-request', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const { project: next, history } = applyEkranDemoRequest(project, { user: request.user })
      const updated = await patchProject(client, project.id, {
        ekran_demo_requested_at: next.ekran_demo_requested_at,
        ekran_demo_requested_by: next.ekran_demo_requested_by,
        ekran_demo_requested_by_name: next.ekran_demo_requested_by_name,
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyEkranDemoRequested(client, { project: updated, actor: request.user })
      }
      return updated
    })
    return result
  })

  fastify.post('/projects/:id/ekran-demo-approve', { schema: schemas.projectsIdParams }, async (request) => {
    await attachUser(request)
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const { project: next, history } = applyEkranDemoApprove(project, { user: request.user })
      const updated = await patchProject(client, project.id, {
        stage: next.stage,
        demo_held: next.demo_held,
        ekran_demo_requested_at: next.ekran_demo_requested_at,
        ekran_demo_requested_by: next.ekran_demo_requested_by,
        ekran_demo_requested_by_name: next.ekran_demo_requested_by_name,
        version: next.version,
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

  fastify.post('/projects/:id/ekran-demo-reject', { schema: schemas.projectsEkranDemoReject }, async (request) => {
    await attachUser(request)
    const { reason } = request.body
    const result = await withTx(async (client) => {
      const project = await getProjectForUpdate(client, request.params.id)
      if (!project) notFound('Proje bulunamadı.')
      assertNotLegacy(project)
      project.assignees = await loadProjectAssignees(client, project)
      const { project: next, history } = applyEkranDemoReject(project, { user: request.user, reason })
      const updated = await patchProject(client, project.id, {
        ekran_demo_requested_at: next.ekran_demo_requested_at,
        ekran_demo_requested_by: next.ekran_demo_requested_by,
        ekran_demo_requested_by_name: next.ekran_demo_requested_by_name,
      })
      if (history) {
        await logHistory(client, { ...history, done_by: request.user.id, done_by_name: request.user.name }, request.user)
        await notifyEkranDemoRejected(client, { project: updated, actor: request.user, assignees: project.assignees, reason: history.reason })
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
      assertNotLegacy(project)
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
        // computeRejection resets the rejected leg's "Başladım"/change-request/
        // delivery ledger (a fresh round, same as a "Teslim Alınamadı" or a new
        // delivery) — persist whichever of these computeRejection touched so
        // the matbaa's "İşlemi Başlatın" button reappears instead of staying
        // hidden behind a stale demo_started/ozalit_started true.
        demo_held: next.demo_held,
        demo_held_at: next.demo_held_at,
        demo_held_by_name: next.demo_held_by_name,
        demo_delivered_at: next.demo_delivered_at,
        demo_delivered_by: next.demo_delivered_by,
        demo_delivered_by_name: next.demo_delivered_by_name,
        demo_received: next.demo_received,
        demo_received_by: next.demo_received_by,
        demo_received_at: next.demo_received_at,
        demo_started: next.demo_started,
        demo_started_at: next.demo_started_at,
        demo_started_by: next.demo_started_by,
        demo_started_by_name: next.demo_started_by_name,
        demo_change_requested_at: next.demo_change_requested_at,
        demo_change_requested_by: next.demo_change_requested_by,
        demo_change_requested_by_name: next.demo_change_requested_by_name,
        demo_change_requested_note: next.demo_change_requested_note,
        demo_fix_pending: next.demo_fix_pending,
        ekran_demo_requested_at: next.ekran_demo_requested_at,
        ekran_demo_requested_by: next.ekran_demo_requested_by,
        ekran_demo_requested_by_name: next.ekran_demo_requested_by_name,
        ozalit_received: next.ozalit_received,
        ozalit_received_by: next.ozalit_received_by,
        ozalit_received_at: next.ozalit_received_at,
        ozalit_started: next.ozalit_started,
        ozalit_started_at: next.ozalit_started_at,
        ozalit_started_by: next.ozalit_started_by,
        ozalit_started_by_name: next.ozalit_started_by_name,
        ozalit_change_requested_at: next.ozalit_change_requested_at,
        ozalit_change_requested_by: next.ozalit_change_requested_by,
        ozalit_change_requested_by_name: next.ozalit_change_requested_by_name,
        ozalit_change_requested_note: next.ozalit_change_requested_note,
        ozalit_fix_pending: next.ozalit_fix_pending,
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
