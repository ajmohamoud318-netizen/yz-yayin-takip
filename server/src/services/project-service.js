/**
 * Project service — orchestrator + dispatch + simple CRUD + barrel.
 *
 * The four jobs that used to live here split across three files:
 *   - this file:    orchestrator (runProjectCommand), notification
 *                   dispatch, simple reads, the two thin state-changing
 *                   CRUD paths (deleteProjectSoft, restoreProjectSoft),
 *                   and the barrel re-exports so callers keep one import.
 *   - admin.js:     bespoke admin CRUD (createProject,
 *                   importLegacyProjects, patchProjectFields,
 *                   setCatalogHidden) — write-the-row, not mutate the FSM.
 *   - transitions.js: 22 transition entry points + named prepare helpers.
 *
 * Routes do `import * as projectService from '../services/project-service.js'`
 * and the namespace keeps the same shape — the barrel at the bottom
 * re-exports admin.js + transitions.js.
 *
 * `runProjectCommand` owns the locking, the `assertNotLegacy` guard, the
 * persist + notify sequencing. Entry points only describe which context
 * the verb needs and which entity method to invoke.
 */

import { withTx, getPool } from '../db/pool.js'
import { notFound } from '../domain/errors.js'
import { Project } from '../domain/entities/Project.js'
import { assertNotLegacy } from '../domain/pipeline.js'
import {
  listProjects as repoListProjects,
  getProject,
  getProjectIncludingDeleted,
  getProjectForUpdate,
  listProjectSubtasks,
  listProjectHistory,
  loadProjectAssignees,
  patchProject,
  deleteProject,
  restoreProject,
  listDeletedProjects,
  logHistory,
  reconcileOzalitApprovals,
} from './project-repository.js'
import {
  notifyProjectTransition,
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
  notifyProjectDeleted,
} from './notifications.js'

// Columns `runProjectCommand` never diffs: the repository bumps `version`
// and `updated_at` in SQL, and `subtasks` is a separate write path. Keep
// this list narrow — every column in here is silently skipped from the diff.
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
 * The orchestrator owns:
 *   - locking via `getProjectForUpdate` (project row only; same scope as slice 1)
 *   - `assertNotLegacy` — every transition is a project-mutation, so we guard
 *     uniformly here. Read endpoints and admin CRUD don't go through this
 *     orchestrator, so they're unaffected.
 *   - the prepare hook's mutations propagate to the entity (prepare runs
 *     before `new Project(row)`)
 *   - persist only what changed (`changedFields` + `patchProject`)
 *   - the subtask UPDATE loop when `event.updatedSubtasks` is set
 *   - the after hook for cross-aggregate work
 *   - notification dispatch
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
    // Every transition is a project-mutation; legacy imports are read-only
    // for the FSM. The guard lives here so every transition entry gets it
    // uniformly — admins (create/import/patch/catalog) and the two CRUD
    // paths below don't go through this orchestrator.
    assertNotLegacy(row)

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
      ? await patchProject(client, projectId, fields, { expectedVersion: before.version })
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

/* ----------------------------- Simple state-changing CRUD ----------------- */

/**
 * DELETE /api/projects/:id — soft delete (team_leader only).
 *
 * Stays outside `runProjectCommand`: legacy imports can be soft-deleted
 * too, so the orchestrator's `assertNotLegacy` guard would be wrong here.
 */
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

/* ----------------------------- One-off orchestrators ------------------------ */

/**
 * Reconcile ozalit approvals after the active team-leader set changes.
 * The full loop stays in the repo (it's N+1 by design — small set, each
 * pass is its own tx to avoid holding a long lock). The repo function and
 * the service entry point share a name; the import is renamed on the way
 * in so this thin re-export reads naturally at the route layer.
 */
export { reconcileOzalitApprovals as reconcileOzalitApprovalsService } from './project-repository.js'

/* ----------------------------- Barrel re-exports --------------------------- */

/**
 * `routes/projects.js` does `import * as projectService from '../services/project-service.js'`
 * and reads `projectService.advanceProject(...)`, `projectService.createProject(...)`, etc.
 * off that namespace. We keep that import shape by re-exporting every entry
 * point from the admin and transitions sibling files below — no caller
 * change required by the file split.
 */
export * from './project-service/admin.js'
export * from './project-service/transitions.js'

// Re-export `runProjectCommand` so the transitions file can use it without
// importing from itself (would create a cycle).
export { runProjectCommand }