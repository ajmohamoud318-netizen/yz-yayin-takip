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
  loadLatestDemoSnapshot,
} from '../project-repository.js'
import { activeUserIdsByRole } from '../notifications.js'
import { listParcaState } from '../parca-state-repository.js'
import { changedParcaBlocks, parcaSetDelta } from '../../domain/spec-parca-diff.js'
import { runProjectCommand } from '../project-service.js'

/**
 * Per-parça approve context (migrations 068/069/070): the FSM gate at
 * demo_onay / ozalit_onay / baski_onay / ekran routes needs the latest
 * snapshot's `_selectedComponents` to know which parçalar are on this
 * round's sheet. Routes pass `kind` so we can match the right snapshot
 * (a project may carry both a `demo` and an `ozalit` row).
 */
function withSnapshot(snapshotKind = 'demo') {
  return async function snapshotPrepare({ client, row }) {
    const base = await withAssigneesAndLeaders({ client, row })
    const snapshot = await loadLatestDemoSnapshot(client, row.id, snapshotKind)
    // Per-parça routing rows (migration 074), stamped onto `row` the same way
    // `withSubtasks` does it for reject. Approve needs them for a different
    // question than reject does: which parçalar are out for rework right now,
    // and so must be kept out of the set a click can sign off. Without this the
    // bulk shortcut approved the very parçalar the leader had just bounced.
    const parcaState = await listParcaState(client, row.id)
    row.parca_state = parcaState
    return { ...base, snapshot, parcaState }
  }
}

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
 * Verbs whose FSM guard asks whether the matbaa is mid-production on any parça
 * of the round (migration 077): the two cancels, alongside the two edits that
 * get theirs from `withDemoSnapshot`.
 *
 * `demo_started` / `ozalit_started` cannot answer that on a split round — the
 * per-parça `started_at` is where the fact moved — so without these rows the
 * guard reads an empty list and never fires, which is the bug rather than the
 * fix. Stamped onto `row` the same way `withSubtasks` does it, so the FSM
 * reads `project.parca_state`.
 */
async function withParcaState({ client, row }) {
  row.parca_state = await listParcaState(client, row.id)
  return { parcaState: row.parca_state }
}

/** `demoCancel`: the parça guard above, plus the assignees the FSM notifies. */
async function withAssigneesAndParcaState({ client, row }) {
  const ctx = await withAssignees({ client, row })
  return { ...ctx, ...(await withParcaState({ client, row })) }
}

/**
 * `advance` + `reject`: need assignees + subtasks (resubmit gate for
 * advance, revizeIds processing for reject).
 */
async function withSubtasks({ client, row }) {
  const ctx = await withAssignees({ client, row })
  const subtasks = await listProjectSubtasks(client, row.id)
  row.subtasks = subtasks
  // Per-parça routing rows (migration 074). `reject` reads them to carry each
  // parça's own round number forward — the project-level attempt counter no
  // longer moves on a per-parça reject, so without this every bounce would
  // reset that parça to round 1 and its spec-sheet snapshot would stop
  // resolving. Stamped onto `row` alongside subtasks/assignees so the FSM can
  // read `project.parca_state` the same way it reads `project.subtasks`.
  const parcaState = await listParcaState(client, row.id)
  row.parca_state = parcaState
  // The round's own parça list, at the three stages where the matbaa delivers.
  //
  // `advance` needs it for a question `parca_state` cannot answer: is this
  // round split into parçalar at all? Rows are materialised on first action, so
  // a fresh multi-parça round has none — and that is exactly the round whose
  // whole-sheet "Teslim Edin" must be refused (see parcalarStillOwed in
  // domain/transitions.js). The sheet is the only place the split is recorded.
  //
  // The kind is inlined rather than mapped: `ozalit_teslim` reads the ozalit
  // sheet, the two demo stages read the demo one, and that is the whole rule.
  if (row.stage === 'demo_teslim' || row.stage === 'cin_demo_teslim' || row.stage === 'ozalit_teslim') {
    const snapshot = await loadLatestDemoSnapshot(
      client, row.id, row.stage === 'ozalit_teslim' ? 'ozalit' : 'demo',
    )
    row.round_parcalar = snapshot?.selectedComponents ?? []
  }
  return { ...ctx, subtasks, parcaState }
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
    // Per-parça routing rows (migration 077), stamped onto `row` the same way
    // withSubtasks / withSnapshot do it. The edit FSM needs them for one
    // question the project row cannot answer: is the matbaa producing any
    // parça of this sheet right now? On a split round `demo_started` is
    // structurally false (startParca never sets it), so without these the
    // guard has nothing to refuse on — see lockedParcalar in domain/transitions.js.
    //
    // Loaded before the early return: a notify with no payload is still an
    // edit the FSM has to authorize, and it is exactly the shape a stale
    // client sends.
    row.parca_state = await listParcaState(client, row.id)

    // The sheet the matbaa is currently holding, read BEFORE the correction is
    // written over it. The edit guard refuses only the locked parçalar this
    // save actually rewrites (migration 077), and that question is unanswerable
    // once the new snapshot is the latest one.
    const baseline = await loadLatestDemoSnapshot(client, row.id, kind)
    const changedParcalar = changedParcaBlocks(baseline?.payload, body?.payload)

    // Whether this save changes what the round IS, as opposed to what one of
    // its parçalar says. Only asked when there is a payload to write: a
    // payload-less notify inserts no snapshot below, so the round's parça list
    // is untouched and there is nothing to refuse.
    const setDelta = body?.payload
      ? parcaSetDelta(baseline?.payload, body.payload)
      : null

    if (!body?.payload) return { demoId: null, changedParcalar, parcaSetDelta: null }
    const snapshot = await insertDemoSnapshot(client, {
      project_id: row.id,
      kind,
      payload: body.payload,
      attempt: body.attempt ?? (kind === 'demo'
        ? (row.demo_attempt ?? 0) + 1
        : (row.ozalit_attempt ?? 0) + 1),
      created_by: actor?.id,
    })
    return { demoId: snapshot?.id ?? null, changedParcalar, parcaSetDelta: setDelta }
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
    run: (project) => project.advance(actor, { note: ctx.note ?? '', route: ctx.route ?? null }),
  }, client)
}

/** POST /api/projects/:id/approve */
export function approveProject(projectId, actor, ctx = {}, client = null) {
  // Per-parça gate (migrations 068/069/070): the snapshot's
  // `_selectedComponents` decides which parçalar the leader has to sign
  // off on this click. Load the latest snapshot for the matching gate
  // (demo/ozalit/baski) so the FSM has the parça list in scope.
  return runProjectCommand(projectId, actor, {
    prepare: withSnapshot(ctx.snapshotKind ?? 'demo'),
    run: (project, pCtx) => project.approve(actor, {
      stage: ctx.stage,
      note: ctx.note ?? '',
      parcalar: ctx.parcalar ?? null,
      designerIds: pCtx.designerIds ?? [],
      teamLeaderIds: pCtx.teamLeaderIds ?? [],
      snapshot: pCtx.snapshot ?? null,
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
export function baskiOnayPrepare(projectId, actor, ctx = {}, client = null) {
  // Per-parça preparer ledger (migrations 068/069/070): each parça on the
  // baski snapshot gets its own preparer row so the approving leader has
  // to be a different person per parça.
  return runProjectCommand(projectId, actor, {
    prepare: withSnapshot('baski_onay'),
    run: (project, pCtx) => project.baskiOnayPrepare(actor, {
      parcalar: ctx.parcalar ?? null,
      snapshot: pCtx.snapshot ?? null,
    }),
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
    prepare: withAssigneesAndParcaState,
    run: (project) => project.demoCancel(actor),
  }, client)
}

/** POST /api/projects/:id/ozalit-cancel. */
export function ozalitCancel(projectId, actor, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withParcaState,
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
    run: (project, pCtx) => project.demoEdit(actor, {
      demoId: pCtx.demoId ?? null,
      changedParcalar: pCtx.changedParcalar,
      parcaSetDelta: pCtx.parcaSetDelta ?? null,
    }),
  }, client)
}

/** POST /api/projects/:id/ozalit-edit-notify — ozalit twin of demo-edit-notify. */
export function ozalitEditNotify(projectId, actor, body = {}, client = null) {
  return runProjectCommand(projectId, actor, {
    prepare: withDemoSnapshot('ozalit', body),
    run: (project, pCtx) => project.ozalitEdit(actor, {
      demoId: pCtx.demoId ?? null,
      changedParcalar: pCtx.changedParcalar,
      parcaSetDelta: pCtx.parcaSetDelta ?? null,
    }),
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
export function ekranDemoApprove(projectId, actor, ctx = {}, client = null) {
  // Per-parça gate (migrations 068/069/070): the ekran-demo approval
  // must also sign off every parça on the snapshot's
  // `_selectedComponents`. Routes pass `parcalar` (optional subset) and
  // we read the latest demo snapshot for the matching gate.
  return runProjectCommand(projectId, actor, {
    prepare: withSnapshot('demo'),
    run: (project, pCtx) => project.ekranDemoApprove(actor, {
      parcalar: ctx.parcalar ?? null,
      snapshot: pCtx.snapshot ?? null,
    }),
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
      // Per-parça reject (migrations 068/069/070): null/omitted =
      // whole-round reject; an array = partial, only those parçalar's
      // approval rows get cleared.
      parcalar: ctx.parcalar ?? null,
    }),
  }, client)
}