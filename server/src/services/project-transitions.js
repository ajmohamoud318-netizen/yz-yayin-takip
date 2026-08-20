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
  computeDemoReceive,
  computeDemoNotReceived,
  computeOzalitReceive,
  computeOzalitNotReceived,
  computeBaskiOnayPrepare,
  computeRejection,
  computeDemoStart,
  computeOzalitStart,
  computeDemoCancel,
  computeOzalitCancel,
  computeDemoChangeRequest,
  computeOzalitChangeRequest,
  computeDemoChangeAccept,
  computeDemoChangeDecline,
  computeOzalitChangeAccept,
  computeOzalitChangeDecline,
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

/**
 * `POST /projects/:id/receive`. Marks a delivered demo "Teslim Alındı". Pass
 * the assigned designer ids so the transition can authorize an assigned
 * designer (besides the team leader).
 */
export function applyDemoReceive(project, { user, designerIds = [] }) {
  return computeDemoReceive(project, user, { designerIds })
}

/**
 * `POST /projects/:id/demo-not-received`. Reports that a delivered demo
 * never reached the leader/designer — sends it back to the matbaa's teslim
 * stage for redelivery.
 */
export function applyDemoNotReceived(project, { user, designerIds = [] }) {
  return computeDemoNotReceived(project, user, { designerIds })
}

/**
 * `POST /projects/:id/ozalit-receive`. Marks a delivered ozalit "Teslim
 * Alındı" — the gate before the multi-party ozalit onay. Pass the assigned
 * designer ids so an assigned designer is authorized alongside the leader.
 */
export function applyOzalitReceive(project, { user, designerIds = [] }) {
  return computeOzalitReceive(project, user, { designerIds })
}

/**
 * `POST /projects/:id/ozalit-not-received`. Reports that a delivered ozalit
 * never reached the leader/designer — sends it back to ozalit_teslim with
 * the matbaa re-delivery lock.
 */
export function applyOzalitNotReceived(project, { user, designerIds = [] }) {
  return computeOzalitNotReceived(project, user, { designerIds })
}

/**
 * `POST /projects/:id/baski-onay-prepare`. Any active team leader may prepare
 * the Baskı Onay Formu; who prepared it is what the later approve branch of
 * `applyApproval` checks against.
 */
export function applyBaskiOnayPrepare(project, { user }) {
  return computeBaskiOnayPrepare(project, user)
}

/** `POST /projects/:id/demo-start`, `/ozalit-start`. Printer marks work begun. */
export function applyDemoStart(project, { user }) {
  return computeDemoStart(project, user)
}
export function applyOzalitStart(project, { user }) {
  return computeOzalitStart(project, user)
}

/**
 * `POST /projects/:id/demo-cancel`, `/ozalit-cancel`. Sends a mistaken
 * request back to tasarim without bumping demo_attempt/ozalit_attempt — only
 * valid before the matbaa has started (see computeDemoCancel).
 */
export function applyDemoCancel(project, { user, designerIds = [] }) {
  return computeDemoCancel(project, user, { designerIds })
}
export function applyOzalitCancel(project, { user, designerIds = [] }) {
  return computeOzalitCancel(project, user, { designerIds })
}

/**
 * `POST /projects/:id/demo-change-request`, `/ozalit-change-request`. Asks
 * the matbaa to accept a cancel/edit once they've started work.
 */
export function applyDemoChangeRequest(project, { user, designerIds = [], note }) {
  return computeDemoChangeRequest(project, user, { note }, { designerIds })
}
export function applyOzalitChangeRequest(project, { user, designerIds = [], note }) {
  return computeOzalitChangeRequest(project, user, { note }, { designerIds })
}

/**
 * `POST /projects/:id/demo-change-accept`, `/demo-change-decline`,
 * `/ozalit-change-accept`, `/ozalit-change-decline`. The matbaa's answer to
 * a pending change-request.
 */
export function applyDemoChangeAccept(project, { user }) {
  return computeDemoChangeAccept(project, user)
}
export function applyDemoChangeDecline(project, { user }) {
  return computeDemoChangeDecline(project, user)
}
export function applyOzalitChangeAccept(project, { user }) {
  return computeOzalitChangeAccept(project, user)
}
export function applyOzalitChangeDecline(project, { user }) {
  return computeOzalitChangeDecline(project, user)
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
