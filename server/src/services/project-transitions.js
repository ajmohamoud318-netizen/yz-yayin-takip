/**
 * Server-side transition module.
 *
 * For this pass we deliberately delegate to the *client*'s
 * `project-transitions.js` — its pure helpers already encode every
 * rule the UI relies on (Ozalt dual-sign-off, demo gates, satellite
 * flags, etc.) and are covered by the client's Vitest suite. The
 * server only adapts the result to a Postgres-friendly { project,
 * history } pair with a bumped version stamp.
 *
 * If the client helpers ever change, the server automatically picks
 * them up — which is the whole point: one source of truth for the
 * project state machine, two surfaces (browser, server).
 */

import {
  computeAdvance,
  computeApproval,
  computeRejection,
} from '../../../client/src/infrastructure/mock/helpers/project-transitions.js'

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

/** `POST /projects/:id/approve`. */
export function applyApproval(project, { user }) {
  // The client `computeApproval` reads the *current* stage from the
  // project shape and dispatches by stage.
  return computeApproval(project, user)
}

/** `POST /projects/:id/reject`. */
export function applyRejection(project, { user, stage, reason, rejectTarget = null, note = '' }) {
  // The client `computeRejection(project, reason, revizeIds, target, { actorName })`.
  // Rejecting at a stage that is not the project's current stage short-
  // circuits with a 409 — preserves the Fastify error contract.
  if (project.stage !== stage) {
    const err = new Error(`Project is at stage "${project.stage}", not "${stage}"`)
    err.status = 409
    throw err
  }
  return computeRejection(project, reason, [], rejectTarget, { actorName: user.name })
}
