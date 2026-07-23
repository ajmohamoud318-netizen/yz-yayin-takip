/**
 * Server-side transition module.
 *
 * Delegates to the server's own `domain/transitions.js` — a deliberate
 * mirror of `client/src/infrastructure/mock/helpers/project-transitions.js`
 * (see the top comment in that file for the sync rule). We can't import
 * the client file directly because the deployed image ships `server/`
 * only, so a relative import into the client tree would resolve to a
 * path that doesn't exist on disk and the container would crash on
 * boot with ERR_MODULE_NOT_FOUND.
 *
 * Each wrapper below returns { project, history } ready for `withTx`,
 * identical in shape to the client helpers, so the route handlers and
 * repository layer don't need to know they're talking to a different
 * copy.
 */

import {
  computeAdvance,
  computeApproval,
  computeRejection,
} from '../domain/transitions.js'

/**
 * Compute the next project state for a `POST /projects/:id/advance`
 * call. Returns { project, history } ready for `withTx`. Throws on
 * invalid transitions (the helpers use the client's `badRequest`,
 * which throws a plain Error with .status = 400 — Fastify's error
 * handler translates it).
 */
export function applyAdvance(project, { user, note = '' }) {
  return computeAdvance(project, user)
}

/**
 * `POST /projects/:id/approve`. For ozalit_onay the approval is multi-party:
 * pass the required approver ids (`teamLeaderIds`, `designerIds`) so the
 * transition can record each approval and advance only once the set is complete.
 */
export function applyApproval(project, { user, teamLeaderIds = [], designerIds = [] }) {
  return computeApproval(project, user, { teamLeaderIds, designerIds })
}

/** `POST /projects/:id/reject`. */
export function applyRejection(project, { user, stage, reason, rejectTarget = null, revizeIds = [], note = '' }) {
  // The client `computeRejection(project, reason, revizeIds, target, { actorName, actor })`.
  // Rejecting at a stage that is not the project's current stage short-
  // circuits with a 409 — preserves the Fastify error contract.
  if (project.stage !== stage) {
    const err = new Error(`Project is at stage "${project.stage}", not "${stage}"`)
    err.status = 409
    throw err
  }
  // Pass the leader's per-subtask revise selection through (previously
  // hard-coded to []), so computeRejection resets exactly those subtasks and
  // recomputes progress. The route persists the resulting subtasks + progress.
  return computeRejection(project, reason, revizeIds ?? [], rejectTarget, {
    actorName: user.name,
    actor: user,
  })
}
