/**
 * Application service for the project pipeline.
 *
 * Owns everything the `Project` entity deliberately refuses to:
 *   - transactions and row locking,
 *   - persistence (via `project-repository.js`),
 *   - cross-aggregate writes (subtask resets on reject — same tx, separate
 *     write path, NOT routed through `changedFields` because subtasks live
 *     in their own table outside `PROJECT_WRITABLE_COLUMNS`),
 *   - notifications.
 *
 * The shape of every mutating command is the same and lives in
 * `runProjectCommand`: lock the row, build the entity, let the entity
 * decide and mutate itself, then persist exactly what it changed and
 * translate the event it returned into side effects.
 *
 * Routes call these functions and return the result.
 */

import { withTx, getPool } from '../db/pool.js'
import { badRequest, notFound } from '../domain/errors.js'
import { Project } from '../domain/entities/Project.js'
import { assertNotLegacy } from '../domain/pipeline.js'
import { ORDERABLE_STAGES } from '../domain/stages.js'
import { subtaskProgress } from '../domain/progress.js'
import {
  listProjects as repoListProjects,
  getProject,
  getProjectIncludingDeleted,
  getProjectForUpdate,
  listProjectSubtasks,
  listProjectHistory,
  loadProjectAssignees,
  insertProject,
  patchProject,
  deleteProject,
  restoreProject,
  setProjectCatalogHidden,
  listDeletedProjects,
  insertDemoSnapshot,
  logHistory,
  reconcileOzalitApprovals,
  seedSubtaskPages,
} from './project-repository.js'
import { captureProductInfoFromSpec, captureHistoryNote } from './product-info-capture.js'
import {
  notifyProjectCreated,
  notifyProjectTransition,
  notifyProjectDeleted,
  notifyDemoReceived,
  notifyOzalitReceived,
  notifyBaskiOnayPrepared,
  notifyDemoStarted,
  notifyOzalitStarted,
  notifyDemoChangeRequested,
  notifyOzalitChangeRequested,
  notifyDemoChangeAccepted,
  notifyDemoChangeDeclined,
  notifyOzalitChangeAccepted,
  notifyOzalitChangeDeclined,
  notifyDemoCancelled,
  notifyOzalitCancelled,
  notifyDemoEdited,
  notifyOzalitEdited,
  notifyEkranDemoRequested,
  notifyEkranDemoRejected,
  notifyProductCatalogChanged,
  activeUserIdsByRole,
} from './notifications.js'

// Columns `runProjectCommand` never diffs: the repository bumps `version`
// and `updated_at` in SQL (via `updateProject` if/when added; the route's
// `patchProject` today sets `updated_at = NOW()` and is what we still call),
// and `subtasks` is a separate write path. Keep this list narrow — every
// column in here is silently skipped from the diff.
const NON_DIFFED_COLUMNS = new Set(['version', 'updated_at', 'subtasks'])

/**
 * The columns the entity actually changed, by comparing it against the row
 * it was built from. Objects are compared structurally because the entity
 * always replaces them wholesale rather than mutating in place.
 */
function changedFields(before, entity) {
  const fields = {}
  for (const key of Object.keys(before)) {
    if (NON_DIFFED_COLUMNS.has(key)) continue
    const prev = before[key]
    const next = entity[key]
    if (prev === next) continue
    if (prev && next && typeof prev === 'object' && typeof next === 'object'
      && JSON.stringify(prev) === JSON.stringify(next)) continue
    fields[key] = next
  }
  return fields
}

/**
 * Translate a project's notification event into the matching notify* call.
 * Routes that didn't change stage (demo-receive, ekran-demo-reject, …) ride
 * their own notifyXxx; the stage-changing verbs all ride notifyProjectTransition.
 */
async function dispatchProjectNotification(client, { notification, project, actor }) {
  if (!notification) return
  switch (notification.kind) {
    case 'transition':
      return notifyProjectTransition(client, {
        project,
        fromStage: project.__prevStage ?? null,
        toStage: project.stage,
        action: project.__prevAction ?? 'advance',
        actor,
        assignees: project.assignees ?? null,
      })
    case 'demoReceived':
      return notifyDemoReceived(client, { project, actor, assignees: project.assignees })
    case 'ozalitReceived':
      return notifyOzalitReceived(client, { project, actor, assignees: project.assignees })
    case 'baskiOnayPrepared':
      return notifyBaskiOnayPrepared(client, {
        project, actor, teamLeaderIds: project.__teamLeaderIds ?? null,
      })
    case 'demoStarted':
      return notifyDemoStarted(client, { project, actor, assignees: project.assignees })
    case 'ozalitStarted':
      return notifyOzalitStarted(client, { project, actor, assignees: project.assignees })
    case 'demoCancelled':
      return notifyDemoCancelled(client, { project, actor })
    case 'ozalitCancelled':
      return notifyOzalitCancelled(client, { project, actor })
    case 'demoEdited':
      return notifyDemoEdited(client, { project, actor })
    case 'ozalitEdited':
      return notifyOzalitEdited(client, { project, actor })
    case 'demoChangeRequested':
      return notifyDemoChangeRequested(client, {
        project, actor, note: notification.note,
      })
    case 'ozalitChangeRequested':
      return notifyOzalitChangeRequested(client, {
        project, actor, note: notification.note,
      })
    case 'demoChangeAccepted':
      return notifyDemoChangeAccepted(client, { project, actor, assignees: project.assignees })
    case 'demoChangeDeclined':
      return notifyDemoChangeDeclined(client, { project, actor, assignees: project.assignees })
    case 'ozalitChangeAccepted':
      return notifyOzalitChangeAccepted(client, { project, actor, assignees: project.assignees })
    case 'ozalitChangeDeclined':
      return notifyOzalitChangeDeclined(client, { project, actor, assignees: project.assignees })
    case 'ekranDemoRequested':
      return notifyEkranDemoRequested(client, { project, actor })
    case 'ekranDemoRejected':
      return notifyEkranDemoRejected(client, {
        project, actor, assignees: notification.assignees, reason: notification.reason,
      })
    default:
      return undefined
  }
}

/**
 * Run one entity command end-to-end inside a transaction.
 *
 * @param {string} projectId
 * @param {object} actor — request.user
 * @param {object} hooks
 * @param {function} hooks.prepare — async ({ client, row, actor }) => ctx
 *   (verb-specific; see Prepare Hook Contract in the plan)
 * @param {function} hooks.run — (project, ctx) => domain event | null
 * @param {function} [hooks.after] — async ({ client, event, updated, project, actor, ctx })
 *   cross-aggregate work that must happen in the same tx (e.g. subtask
 *   UPDATEs on reject, product-info capture on baski_onay approve).
 * @param {object} [client] — an already-open transaction to run inside.
 *   Production routes never pass one (each request is its own transaction);
 *   the service tests use it to drive a fake pg client through this exact
 *   orchestration.
 */
async function runProjectCommand(projectId, actor, { prepare, run, after } = {}, client = null) {
  const body = async (client) => {
    const row = await getProjectForUpdate(client, projectId)
    if (!row) notFound('Proje bulunamadı.')

    // `prepare` runs BEFORE the entity is built so its mutations to `row`
    // (e.g. loading subtasks / assignees that the FSM needs) propagate into
    // the entity. `before` is then snapshotted as the diff baseline — the
    // values prepare loaded are NOT in the diff because they're not writable
    // project columns (the repo filters via PROJECT_WRITABLE_COLUMNS, and
    // `subtasks` is in NON_DIFFED_COLUMNS).
    const ctx = prepare ? await prepare({ client, row, actor }) : {}
    const before = { ...row }
    const project = new Project(row)
    project.__prevStage = row.stage

    const event = await run(project, ctx)
    // Idempotent no-op — nothing to persist, log or announce.
    if (!event) return row

    // Stash fields the dispatch helper needs from ctx onto the entity so
    // dispatchProjectNotification doesn't need a separate ctx arg.
    project.__teamLeaderIds = ctx.teamLeaderIds ?? null

    const fields = changedFields(before, project)
    const updated = Object.keys(fields).length > 0
      ? await patchProject(client, projectId, fields)
      : row

    if (event.projectHistory) {
      await logHistory(client, event.projectHistory, actor)
    }

    // Subtask UPDATEs (separate write path, see plan "Two Write Paths").
    if (event.updatedSubtasks) {
      for (const s of event.updatedSubtasks) {
        await client.query(
          `UPDATE subtasks
              SET is_done = $2, done_at = $3, pages_done = $4, needs_revize = $5, updated_at = NOW()
            WHERE id = $1`,
          [s.id, !!s.is_done, s.done_at ?? null, s.pages_done ?? null, !!s.needs_revize],
        )
      }
    }

    if (after) await after({ client, event, updated, project, actor, ctx })

    // Notify after every write is queued in the tx; emit() registers an
    // afterCommit hook for the actual push delivery. The dispatch helper
    // reads `project.assignees` for the recipient set — we hand it the
    // entity (which the prepare hook stamped onto `row.assignees`), not
    // `updated` (which is the RETURNING row from `patchProject` and only
    // carries PROJECT_COLUMNS — `assignees` is not one of them).
    await dispatchProjectNotification(client, {
      notification: event.notification,
      project,
      actor,
    })

    // Cleanup stashed ctx fields so they don't leak out.
    delete project.__prevStage
    delete project.__teamLeaderIds
    return updated
  }
  return client ? body(client) : withTx(body)
}

/**
 * Hydrate the assignees + (optionally) subtasks + (optionally) team-leader
 * set onto the row the FSM needs. The service entry points compose this
 * with the entity method.
 *
 * Used by the verbs that need `assignees` per the Prepare Hook Contract.
 */
async function prepareAssignees({ client, row }) {
  const assignees = await loadProjectAssignees(client, row)
  // Stamp onto row so the FSM reads them off `row.assignees` and so the
  // dispatch helper can pass them to notify*.
  row.assignees = assignees
  return { assignees, designerIds: assignees.map((a) => a.id) }
}

/**
 * Advance requires both assignees AND subtasks (resubmit gate). The FSM
 * reads `project.subtasks` directly, so we stamp onto `row`.
 */
async function prepareAssigneesAndSubtasks({ client, row }) {
  const ctx = await prepareAssignees({ client, row })
  const subtasks = await listProjectSubtasks(client, row.id)
  row.subtasks = subtasks
  return { ...ctx, subtasks }
}

/**
 * Approve at ozalit_onay is multi-party — needs the active team-leader set
 * resolved by the DB rather than trusting the client's view.
 */
async function prepareForApprove({ client, row }) {
  const ctx = await prepareAssignees({ client, row })
  const teamLeaderIds = await activeUserIdsByRole(client, 'team_leader')
  return { ...ctx, teamLeaderIds }
}

/* ----------------------------- READ entry points ---------------------------- */

/** GET /api/projects */
export async function listProjects() {
  return repoListProjects()
}

/**
 * GET /api/projects/:id — returns the project + subtasks + history +
 * assignees + a derived `assigned_name` summary.
 *
 * Mirrors the pre-refactor route's exact response shape: the SPA reads
 * `assignees`, `assigned_name`, `subtasks`, `history` off this payload.
 */
export async function getProjectDetail(id) {
  const project = await getProjectIncludingDeleted(id)
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
}

/** GET /api/projects/deleted — list soft-deleted projects (team_leader only). */
export async function listDeletedProjectsOnly() {
  return listDeletedProjects()
}

/* ---------------------------- CREATE / UPDATE / DELETE --------------------- */

/**
 * POST /api/projects — create a new project + its subtasks.
 *
 * The bulk of the body parsing (subtaskAssignees lookup, kind='pages' page
 * seeding, progress recompute) stays here, NOT in the route, because the
 * create flow is a single business operation — there's no entity method to
 * delegate to. `Order` did exactly the same: order creation has its own
 * service entry point because there's no prior state to mutate.
 */
export async function createProject(actor, body) {
  const {
    title, type, target_month, subtasks = [], pass_kind,
    assigned_to, assignees = [], subtaskAssignees = {},
  } = body
  const primaryAssignee = assigned_to ?? (Array.isArray(assignees) && assignees[0]) ?? null

  return withTx(async (client) => {
    const project = await insertProject(client, {
      title, type, target_month, pass_kind, assigned_to: primaryAssignee,
      created_by: actor.id,
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
      if (rows[0].kind === 'pages' && Number(rows[0].total_pages) > 0) {
        await seedSubtaskPages(client, rows[0].id, rows[0].total_pages, subAssignee)
      }
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
      actor,
    )
    // Notify the assigned designer(s). Subtasks were just inserted in this
    // same tx, so loadProjectAssignees (called inside the helper) sees them.
    await notifyProjectCreated(client, { project: updated, actor })
    return { ...updated, subtasks: subRows, history: [] }
  })
}

/**
 * POST /api/projects/import — legacy/backlist product batch import.
 *
 * Whole batch runs in ONE transaction: a half-imported catalog is worse
 * than a rejected file, and `dryRun` relies on being able to roll back
 * after doing every real check.
 */
export async function importLegacyProjects(actor, items, dryRun = false) {
  // Duplicate detection is on normalised title (case-insensitive, collapsed
  // whitespace) against live projects AND within the batch itself.
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
      if (!ORDERABLE_STAGES.has(stage)) {
        badRequest(`Kayıtlı ürün yalnızca üretime hazır ve sonrası aşamalara aktarılabilir (satır ${index + 1}).`)
      }

      const project = await insertProject(client, {
        id: item.id,
        title: item.title,
        type: item.type,
        stage,
        progress: 100,
        pass_kind: item.pass_kind ?? 'first_edition',
        target_month: item.target_month ?? null,
        assigned_to: null,
        origin: 'legacy',
        created_by: actor.id,
      })

      if (components.length > 0) {
        await client.query(
          `INSERT INTO product_info (project_id, components, updated_by, updated_at)
           VALUES ($1, $2::jsonb, $3, NOW())
           ON CONFLICT (project_id)
           DO UPDATE SET components = EXCLUDED.components,
                         updated_by = EXCLUDED.updated_by,
                         updated_at = NOW()`,
          [project.id, JSON.stringify(components), actor.id],
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
        actor,
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
}

/**
 * PATCH /api/projects/:id — edit title / type / target_month / assigned_to.
 *
 * Builds a per-field diff description for the timeline ("Tasarımcı
 * değiştirildi → Aylin") and resolves `assigned_to` to a name. Behaves
 * like the pre-refactor route.
 */
export async function patchProjectFields(id, actor, fields) {
  // Schema already restricts to the allowed keys; no manual filter needed.
  return withTx(async (client) => {
    const before = await getProjectForUpdate(client, id)
    if (!before) notFound('Proje bulunamadı.')
    const updated = await patchProject(client, id, fields)
    if (!updated) notFound('Proje bulunamadı.')
    const FIELD_LABELS = {
      title: 'Başlık',
      type: 'Tür (TR / ÇİN)',
      target_month: 'Hedef ay',
      assigned_to: 'Tasarımcı',
    }
    const changes = []
    for (const [key, label] of Object.entries(FIELD_LABELS)) {
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
        actor,
      )
    }
    return updated
  })
}

/** DELETE /api/projects/:id — soft delete (team_leader only). */
export async function deleteProjectSoft(id, actor) {
  return withTx(async (client) => {
    const project = await getProjectForUpdate(client, id)
    if (!project) notFound('Proje bulunamadı.')
    const assignees = await loadProjectAssignees(client, project)
    await deleteProject(client, project.id, actor)
    await notifyProjectDeleted(client, { project, actor, assignees })
    return { ok: true }
  })
}

/** POST /api/projects/:id/restore — undo a soft delete (team_leader only). */
export async function restoreProjectSoft(id) {
  const restored = await restoreProject(id)
  if (!restored) notFound('Silinmiş proje bulunamadı.')
  return restored
}

/**
 * POST /api/projects/:id/catalog — kaldır / geri al in Ürünler
 * (team_leader only). Only orderable-stage projects can be catalog-listed;
 * hiding anything earlier is a no-op that the leader couldn't see or undo.
 */
export async function setCatalogHidden(id, actor, hidden, note) {
  await withTx(async (client) => {
    const project = await getProjectForUpdate(client, id)
    if (!project) notFound('Proje bulunamadı.')
    if (hidden && !ORDERABLE_STAGES.has(project.stage)) {
      badRequest('Yalnızca katalogdaki (üretime hazır ve sonrası) ürünler kaldırılabilir.')
    }
    // Idempotent: re-sending the same state is a no-op rather than a second
    // history row + notification for a change that didn't happen.
    if (!!project.catalog_hidden === hidden) return
    await setProjectCatalogHidden(client, project.id, hidden, actor)
    await logHistory(client, {
      project_id: project.id,
      action: 'system',
      event: hidden ? 'catalog_delist' : 'catalog_relist',
      from_stage: project.stage,
      to_stage: project.stage,
      pass_number: project.pass_number ?? 1,
      note: note || (hidden ? 'Ürün katalogdan kaldırıldı.' : 'Ürün katalogda tekrar yayında.'),
    }, actor)
    await notifyProductCatalogChanged(client, { project, actor, hidden })
  })
  // Re-read outside the tx: `setProjectCatalogHidden` returns the raw column
  // set, which has no `has_product_info` — the Ürünler row needs it to decide
  // between the "Sipariş" action and the "ürün bilgisi eksik" warning.
  return getProject(id)
}

/* ----------------------- Transition entry points (runProjectCommand) ----- */

/** POST /api/projects/:id/advance */
export function advanceProject(projectId, actor, ctx = {}, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      await prepareAssigneesAndSubtasks({ client, row })
      return {}
    },
    run: (project) => project.advance(actor, { note: ctx.note ?? '' }),
  }, client)
}

/** POST /api/projects/:id/approve */
export function approveProject(projectId, actor, ctx = {}, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: prepareForApprove,
    run: (project) => project.approve(actor, { stage: ctx.stage, note: ctx.note ?? '' }),
    async after({ client, project, actor, event }) {
      // Entering production is the point the spec stops changing, so the
      // approved baski_onay/cin_baski_onay (fallback: ozalit/demo) sheet is
      // copied into Ürün Bilgileri here. Without it a project can reach
      // Baskıda with a fully signed sheet and still have no spec, which
      // blocks Sales from ordering it at all.
      if (project.stage === 'baskida' && project.__prevStage !== 'baskida') {
        const captured = await captureProductInfoFromSpec(client, { project, actor })
        if (captured) {
          await logHistory(
            client,
            {
              project_id: project.id,
              from_stage: project.stage,
              to_stage: project.stage,
              action: 'system',
              event: 'product_info_auto',
              note: captureHistoryNote([...captured.added, ...captured.updated]),
            },
            actor,
          )
        }
      }
    },
  }, client)
}

/** POST /api/projects/:id/receive — demo "Teslim Alındı". */
export function receiveDemo(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      await prepareAssignees({ client, row })
      return {}
    },
    run: (project) => project.demoReceive(actor),
  }, client)
}

/** POST /api/projects/:id/demo-not-received. */
export function demoNotReceived(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      await prepareAssignees({ client, row })
      return {}
    },
    run: (project) => project.demoNotReceived(actor),
  }, client)
}

/** POST /api/projects/:id/ozalit-receive — ozalit "Teslim Alındı". */
export function ozalitReceive(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      await prepareAssignees({ client, row })
      return {}
    },
    run: (project) => project.ozalitReceive(actor),
  }, client)
}

/** POST /api/projects/:id/ozalit-not-received. */
export function ozalitNotReceived(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      await prepareAssignees({ client, row })
      return {}
    },
    run: (project) => project.ozalitNotReceived(actor),
  }, client)
}

/** POST /api/projects/:id/baski-onay-prepare. */
export function baskiOnayPrepare(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client }) => {
      const teamLeaderIds = await activeUserIdsByRole(client, 'team_leader')
      return { teamLeaderIds }
    },
    run: (project) => project.baskiOnayPrepare(actor),
  }, client)
}

/** POST /api/projects/:id/demo-start. */
export function demoStart(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      await prepareAssignees({ client, row })
      return {}
    },
    run: (project) => project.demoStart(actor),
  }, client)
}

/** POST /api/projects/:id/ozalit-start. */
export function ozalitStart(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      await prepareAssignees({ client, row })
      return {}
    },
    run: (project) => project.ozalitStart(actor),
  }, client)
}

/** POST /api/projects/:id/demo-cancel. */
export function demoCancel(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      await prepareAssignees({ client, row })
      return {}
    },
    run: (project) => project.demoCancel(actor),
  }, client)
}

/** POST /api/projects/:id/ozalit-cancel. */
export function ozalitCancel(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      return {}
    },
    run: (project) => project.ozalitCancel(actor),
  }, client)
}

/**
 * POST /api/projects/:id/demo-edit-notify.
 *
 * The corrected sheet is written HERE, inside this transaction, rather than
 * by a separate POST /demos the client fired first: applyDemoEdit's throw
 * has to be able to roll the correction back.
 */
export function demoEditNotify(projectId, actor, body = {}, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      await prepareAssignees({ client, row })
      if (!body.payload) return { demoId: null }
      const snapshot = await insertDemoSnapshot(client, {
        project_id: row.id,
        kind: 'demo',
        payload: body.payload,
        attempt: body.attempt ?? (row.demo_attempt ?? 0) + 1,
        created_by: actor?.id,
      })
      return { demoId: snapshot?.id ?? null }
    },
    run: (project) => project.demoEdit(actor, { demoId: undefined }),
  }, client)
}

/** POST /api/projects/:id/ozalit-edit-notify — ozalit twin of demo-edit-notify. */
export function ozalitEditNotify(projectId, actor, body = {}, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      if (!body.payload) return { demoId: null }
      const snapshot = await insertDemoSnapshot(client, {
        project_id: row.id,
        kind: 'ozalit',
        payload: body.payload,
        attempt: body.attempt ?? (row.ozalit_attempt ?? 0) + 1,
        created_by: actor?.id,
      })
      return { demoId: snapshot?.id ?? null }
    },
    run: (project) => project.ozalitEdit(actor, { demoId: undefined }),
  }, client)
}

/** POST /api/projects/:id/demo-change-request. */
export function demoChangeRequest(projectId, actor, ctx = {}, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      await prepareAssignees({ client, row })
      return {}
    },
    run: (project) => project.demoChangeRequest(actor, { note: ctx.note }),
  }, client)
}

/** POST /api/projects/:id/ozalit-change-request. */
export function ozalitChangeRequest(projectId, actor, ctx = {}, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      return {}
    },
    run: (project) => project.ozalitChangeRequest(actor, { note: ctx.note }),
  }, client)
}

/** POST /api/projects/:id/demo-change-accept. */
export function demoChangeAccept(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      await prepareAssignees({ client, row })
      return {}
    },
    run: (project) => project.demoChangeAccept(actor),
  }, client)
}

/** POST /api/projects/:id/demo-change-decline. */
export function demoChangeDecline(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      await prepareAssignees({ client, row })
      return {}
    },
    run: (project) => project.demoChangeDecline(actor),
  }, client)
}

/** POST /api/projects/:id/ozalit-change-accept. */
export function ozalitChangeAccept(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      await prepareAssignees({ client, row })
      return {}
    },
    run: (project) => project.ozalitChangeAccept(actor),
  }, client)
}

/** POST /api/projects/:id/ozalit-change-decline. */
export function ozalitChangeDecline(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      await prepareAssignees({ client, row })
      return {}
    },
    run: (project) => project.ozalitChangeDecline(actor),
  }, client)
}

/** POST /api/projects/:id/ekran-demo-request. */
export function ekranDemoRequest(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      await prepareAssignees({ client, row })
      return {}
    },
    run: (project) => project.ekranDemoRequest(actor),
  }, client)
}

/** POST /api/projects/:id/ekran-demo-approve. */
export function ekranDemoApprove(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      await prepareAssignees({ client, row })
      return {}
    },
    run: (project) => project.ekranDemoApprove(actor),
  }, client)
}

/** POST /api/projects/:id/ekran-demo-reject. */
export function ekranDemoReject(projectId, actor, ctx = {}, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      const assignees = await loadProjectAssignees(client, row)
      row.assignees = assignees
      return { assignees }
    },
    run: (project, ctx2) => project.ekranDemoReject(actor, {
      reason: ctx.reason,
      assignees: ctx2.assignees,
    }),
  }, client)
}

/** POST /api/projects/:id/reject. */
export function rejectProject(projectId, actor, ctx = {}, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: async ({ client, row }) => {
      assertNotLegacy(row)
      const subtasks = await listProjectSubtasks(client, row.id)
      row.subtasks = subtasks
      const assignees = await loadProjectAssignees(client, row)
      row.assignees = assignees
      return { assignees, subtasks }
    },
    run: (project) => project.reject(actor, {
      reason: ctx.reason,
      rejectTarget: ctx.rejectTarget ?? null,
      revizeIds: ctx.revizeIds ?? [],
      note: ctx.note ?? '',
    }),
  }, client)
}

/* --------------------------- One-off orchestrators ------------------------ */

/**
 * Reconcile ozalit approvals after the active team-leader set changes.
 * The full loop stays in the repo (it's N+1 by design — small set, each
 * pass is its own tx to avoid holding a long lock). The repo function and
 * the service entry point share a name; the import is renamed on the way
 * in so this thin re-export reads naturally at the route layer.
 */
export { reconcileOzalitApprovals as reconcileOzalitApprovalsService } from './project-repository.js'