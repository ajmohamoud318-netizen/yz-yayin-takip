/**
 * Transition entry points for the Project pipeline.
 *
 * Each exported verb is a thin wrapper around `runProjectCommand` that
 * names its prepare context and the entity method it calls. The
 * orchestrator owns the locking, the `assertNotLegacy` guard, and the
 * persist + notify sequencing — these entry points only describe which
 * context the verb needs and which entity method to invoke.
 *
 * Per-verb explicitness over a table-driven dispatch: each verb's
 * signature is right here, easy to find with git grep, easy to set a
 * breakpoint on, easy to extend with new ctx fields without rippling
 * through a table.
 */

import {
  loadProjectAssignees,
  listProjectSubtasks,
  insertDemoSnapshot,
} from '../project-repository.js'
import { activeUserIdsByRole } from '../notifications.js'
import { runProjectCommand } from '../project-service.js'

/* --------------------------------------------------------------------------
 * Named prepare-context helpers
 *
 * One per row of the prepare-hook table in the plan doc. Each helper
 * loads what the verb needs onto the row + returns the same shape into
 * ctx, which the entity method reads via `this.assignees` etc. (they
 * were stamped onto row in slice 1's orchestrator). assertNotLegacy is
 * the orchestrator's job, not the helpers'.
 * ------------------------------------------------------------------------ */

/** No extra context — the verb is a pure FSM call. */
async function noContext() {}

/**
 * Designer-gated verbs: load assignees so the FSM can check the
 * leader/assigned-designer gate.
 */
async function withAssignees({ client, row }) {
  const assignees = await loadProjectAssignees(client, row)
  row.assignees = assignees
  return { assignees, designerIds: assignees.map((a) => a.id) }
}

/**
 * `advance` + `reject`: need assignees + subtasks (resubmit gate for
 * advance, revizeIds processing for reject).
 */
async function withSubtasks({ client, row }) {
  const ctx = await withAssignees({ client, row })
  const subtasks = await listProjectSubtasks(client, row.id)
  row.subtasks = subtasks
  return { ...ctx, subtasks }
}

/**
 * `approve` at ozalit_onay / baski_onay / cin_baski_onay: the multi-party
 * approval set needs the active team-leader id list.
 */
async function withAssigneesAndLeaders({ client, row }) {
  const ctx = await withAssignees({ client, row })
  const teamLeaderIds = await activeUserIdsByRole(client, 'team_leader')
  return { ...ctx, teamLeaderIds }
}

/**
 * `baskiOnayPrepare`: only the team-leader set is needed (for the
 * notification fan-out to "other active leaders"). No assignees
 * because the FSM's only check here is the preparer's role.
 */
async function withLeaders({ client }) {
  const teamLeaderIds = await activeUserIdsByRole(client, 'team_leader')
  return { teamLeaderIds }
}

/**
 * `demoEditNotify` / `ozalitEditNotify`: insert the corrected sheet
 * snapshot inside the same tx so the FSM's `clear fix_pending` can
 * roll back together with a refused insert. Returns `{ demoId }` —
 * the entity uses it via ctx (slice-1 note: the slice-1 entry points
 * don't currently pass ctx.demoId to the entity — preserved here so
 * slice 2 is pure relocation; fixing that is a slice-1 follow-up).
 */
function withDemoSnapshot(kind, body) {
  return async function demoSnapshotPrepare({ client, row, actor }) {
    if (!body?.payload) return { demoId: null }
    const snapshot = await insertDemoSnapshot(client, {
      project_id: row.id,
      kind,
      payload: body.payload,
      attempt: body.attempt ?? (kind === 'demo'
        ? (row.demo_attempt ?? 0) + 1
        : (row.ozalit_attempt ?? 0) + 1),
      created_by: actor?.id,
    })
    return { demoId: snapshot?.id ?? null }
  }
}

/* --------------------------------------------------------------------------
 * Per-verb entry points
 *
 * Each is a 3- to 5-line wrapper. Verb name matches the route's
 * URL segment so a stack trace through the service reads the same as
 * a stack trace through the route.
 * ------------------------------------------------------------------------ */

/** POST /api/projects/:id/advance */
export function advanceProject(projectId, actor, ctx = {}, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withSubtasks,
    run: (project) => project.advance(actor, { note: ctx.note ?? '' }),
  }, client)
}

/** POST /api/projects/:id/approve */
export function approveProject(projectId, actor, ctx = {}, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withAssigneesAndLeaders,
    run: (project, pCtx) => project.approve(actor, {
      stage: ctx.stage,
      note: ctx.note ?? '',
      designerIds: pCtx.designerIds ?? [],
      teamLeaderIds: pCtx.teamLeaderIds ?? [],
    }),
  }, client)
}

/** POST /api/projects/:id/receive — demo "Teslim Alındı". */
export function receiveDemo(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withAssignees,
    run: (project, pCtx) => project.demoReceive(actor, {
      designerIds: pCtx.designerIds ?? [],
    }),
  }, client)
}

/** POST /api/projects/:id/demo-not-received. */
export function demoNotReceived(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withAssignees,
    run: (project, pCtx) => project.demoNotReceived(actor, {
      designerIds: pCtx.designerIds ?? [],
    }),
  }, client)
}

/** POST /api/projects/:id/ozalit-receive — ozalit "Teslim Alındı". */
export function ozalitReceive(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withAssignees,
    run: (project, pCtx) => project.ozalitReceive(actor, {
      designerIds: pCtx.designerIds ?? [],
    }),
  }, client)
}

/** POST /api/projects/:id/ozalit-not-received. */
export function ozalitNotReceived(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withAssignees,
    run: (project, pCtx) => project.ozalitNotReceived(actor, {
      designerIds: pCtx.designerIds ?? [],
    }),
  }, client)
}

/** POST /api/projects/:id/baski-onay-prepare. */
export function baskiOnayPrepare(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withLeaders,
    run: (project) => project.baskiOnayPrepare(actor),
  }, client)
}

/** POST /api/projects/:id/demo-start. */
export function demoStart(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withAssignees,
    run: (project) => project.demoStart(actor),
  }, client)
}

/** POST /api/projects/:id/ozalit-start. */
export function ozalitStart(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withAssignees,
    run: (project) => project.ozalitStart(actor),
  }, client)
}

/** POST /api/projects/:id/demo-cancel. */
export function demoCancel(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withAssignees,
    run: (project) => project.demoCancel(actor),
  }, client)
}

/** POST /api/projects/:id/ozalit-cancel. */
export function ozalitCancel(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: noContext,
    run: (project) => project.ozalitCancel(actor),
  }, client)
}

/**
 * POST /api/projects/:id/demo-edit-notify.
 *
 * The corrected sheet is written HERE, inside this transaction, rather than
 * by a separate POST /demos the client fired first: applyDemoEdit's throw
 * has to be able to roll the correction back. The `body` is captured by
 * closure when the named prepare helper is built below.
 */
export function demoEditNotify(projectId, actor, body = {}, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withDemoSnapshot('demo', body),
    run: (project, pCtx) => project.demoEdit(actor, { demoId: pCtx.demoId ?? null }),
  }, client)
}

/** POST /api/projects/:id/ozalit-edit-notify — ozalit twin of demo-edit-notify. */
export function ozalitEditNotify(projectId, actor, body = {}, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withDemoSnapshot('ozalit', body),
    run: (project, pCtx) => project.ozalitEdit(actor, { demoId: pCtx.demoId ?? null }),
  }, client)
}

/** POST /api/projects/:id/demo-change-request. */
export function demoChangeRequest(projectId, actor, ctx = {}, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withAssignees,
    run: (project) => project.demoChangeRequest(actor, { note: ctx.note }),
  }, client)
}

/** POST /api/projects/:id/ozalit-change-request. */
export function ozalitChangeRequest(projectId, actor, ctx = {}, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: noContext,
    run: (project) => project.ozalitChangeRequest(actor, { note: ctx.note }),
  }, client)
}

/** POST /api/projects/:id/demo-change-accept. */
export function demoChangeAccept(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withAssignees,
    run: (project) => project.demoChangeAccept(actor),
  }, client)
}

/** POST /api/projects/:id/demo-change-decline. */
export function demoChangeDecline(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withAssignees,
    run: (project) => project.demoChangeDecline(actor),
  }, client)
}

/** POST /api/projects/:id/ozalit-change-accept. */
export function ozalitChangeAccept(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withAssignees,
    run: (project) => project.ozalitChangeAccept(actor),
  }, client)
}

/** POST /api/projects/:id/ozalit-change-decline. */
export function ozalitChangeDecline(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withAssignees,
    run: (project) => project.ozalitChangeDecline(actor),
  }, client)
}

/** POST /api/projects/:id/ekran-demo-request. */
export function ekranDemoRequest(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withAssignees,
    run: (project) => project.ekranDemoRequest(actor),
  }, client)
}

/** POST /api/projects/:id/ekran-demo-approve. */
export function ekranDemoApprove(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withAssignees,
    run: (project) => project.ekranDemoApprove(actor),
  }, client)
}

/** POST /api/projects/:id/ekran-demo-reject. */
export function ekranDemoReject(projectId, actor, ctx = {}, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withAssignees,
    run: (project, ctx2) => project.ekranDemoReject(actor, {
      reason: ctx.reason,
      assignees: ctx2?.assignees,
    }),
  }, client)
}

/** POST /api/projects/:id/reject. */
export function rejectProject(projectId, actor, ctx = {}, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withSubtasks,
    run: (project) => project.reject(actor, {
      reason: ctx.reason,
      rejectTarget: ctx.rejectTarget ?? null,
      revizeIds: ctx.revizeIds ?? [],
      note: ctx.note ?? '',
    }),
  }, client)
}