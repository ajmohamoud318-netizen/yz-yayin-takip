/**
 * Project aggregate root.
 *
 * Owns every state-changing rule for a `projects` row. Each method:
 *   1. validates preconditions (state, actor role, ownership),
 *   2. mutates the entity in place,
 *   3. returns a structured domain event (or `null` for idempotent no-op).
 *
 * The entity never touches SQL, never fires notifications, never writes
 * cross-aggregate history (project timeline, subtasks). The application
 * service (`services/project-service.js`) is responsible for translating
 * events into persistence + side effects.
 *
 * The actual FSM helpers in `domain/transitions.js` are kept as-is: they
 * return `{ project, history }` and we copy the next-state fields onto
 * `this` here. This wrapper exists so the route and service layers can
 * call `project.advance(...)` instead of hand-rolling the field diff that
 * the pre-refactor route did on every handler.
 *
 * Field naming follows the DB schema (snake_case) so the entity can be
 * constructed directly from a row and persisted back without translation.
 */

import {
  computeAdvance,
  computeApproval,
  computeEkranDemoRequest,
  computeEkranDemoApprove,
  computeEkranDemoReject,
  computeDemoReceive,
  computeDemoNotReceived,
  computeOzalitReceive,
  computeOzalitNotReceived,
  computeDemoStart,
  computeOzalitStart,
  computeDemoCancel,
  computeOzalitCancel,
  computeDemoEdit,
  computeOzalitEdit,
  computeDemoChangeRequest,
  computeOzalitChangeRequest,
  computeDemoChangeAccept,
  computeDemoChangeDecline,
  computeOzalitChangeAccept,
  computeOzalitChangeDecline,
  computeBaskiOnayPrepare,
  computeRejection,
} from '../transitions.js'

/**
 * Wrap a `compute*` call. Returns null when the FSM said no-op (history
 * was null), otherwise mutates `project` from the FSM's returned `project`
 * and returns an event derived from the FSM's `history` entry.
 *
 * The entity stays in sync with whatever the FSM decided — without this,
 * a `compute*` that returned `{ project: { ...project, demo_received: true } }`
 * would leave the entity's `demo_received` stale and a downstream diff
 * would miss the column.
 */
function runFsm(project, computeFn, args, eventType, notification) {
  const result = computeFn.apply(null, [project, ...args])
  if (!result || result.history === null) return null
  Object.assign(project, result.project)
  return {
    type: eventType,
    projectHistory: result.history,
    notification,
  }
}

export class Project {
  constructor(record) {
    Object.assign(this, record)
    this._events = []
  }

  _record(event) {
    this._events.push(event)
    return event
  }

  /** Pull all recorded events; the entity's internal buffer is cleared. */
  pullEvents() {
    const out = this._events
    this._events = []
    return out
  }

  /**
   * Generic forward advance. The advance route already loaded assignees
   * and subtasks onto the row so computeAdvance can read them.
   *
   * ctx: { note, route }
   *
   * `route` ('ozalit' | 'ekran') is only meaningful on an ozalit-revision
   * resubmit, where computeAdvance requires it — see migration 061.
   */
  advance(actor, ctx = {}) {
    const event = runFsm(this, computeAdvance, [actor, { route: ctx.route ?? null }], 'project.advance', {
      kind: 'transition',
    })
    if (!event) return null
    return this._record(event)
  }

  /**
   * Multi-party approve at ozalit_onay; dual-leader approve at
   * baski_onay / cin_baski_onay; single-step approve everywhere else.
   * The team-leader set lives in ctx and is loaded by the service.
   *
   * ctx: { teamLeaderIds, designerIds }
   */
  approve(actor, ctx = {}) {
    const event = runFsm(this, computeApproval, [actor, ctx], 'project.approve', {
      kind: 'transition',
    })
    if (!event) return null
    return this._record(event)
  }

  /** Request an Ekran Demo Onayı instead of a physical re-demo. */
  ekranDemoRequest(actor) {
    const event = runFsm(this, computeEkranDemoRequest, [actor], 'project.ekran_demo_requested', {
      kind: 'ekranDemoRequested',
    })
    if (!event) return null
    return this._record(event)
  }

  /** Approve a pending Ekran Demo Onayı — advances to ozalit_teslim (TR) / baskida (ÇİN). */
  ekranDemoApprove(actor) {
    const event = runFsm(this, computeEkranDemoApprove, [actor], 'project.ekran_demo_approved', {
      kind: 'transition',
    })
    if (!event) return null
    return this._record(event)
  }

  /**
   * Decline a pending Ekran Demo Onayı. The history row carries the
   * rejection reason (the FSM sets it on `history.reason`).
   *
   * ctx: { reason }
   */
  ekranDemoReject(actor, ctx = {}) {
    const event = runFsm(this, computeEkranDemoReject, [actor, ctx], 'project.ekran_demo_rejected', {
      kind: 'ekranDemoRejected',
      assignees: ctx.assignees ?? null,
      reason: ctx.reason ?? '',
    })
    if (!event) return null
    return this._record(event)
  }

  /**
   * Mark a delivered demo "Teslim Alındı". Idempotent — the FSM returns
   * `history: null` on the second click and `runFsm` short-circuits to
   * `null` so the service skips the write and notify.
   *
   * ctx: { designerIds }
   */
  demoReceive(actor, ctx = {}) {
    const event = runFsm(this, computeDemoReceive, [actor, ctx], 'project.demo_received', {
      kind: 'demoReceived',
    })
    if (!event) return null
    return this._record(event)
  }

  /**
   * Counterpart to demoReceive — the delivered demo never arrived.
   * Sends the project back to *_teslim and bumps demo_attempt.
   *
   * ctx: { designerIds }
   */
  demoNotReceived(actor, ctx = {}) {
    const event = runFsm(this, computeDemoNotReceived, [actor, ctx], 'project.demo_not_received', {
      kind: 'transition',
    })
    if (!event) return null
    return this._record(event)
  }

  /** Ozalit twin of demoReceive — same gate, same idempotency. */
  ozalitReceive(actor, ctx = {}) {
    const event = runFsm(this, computeOzalitReceive, [actor, ctx], 'project.ozalit_received', {
      kind: 'ozalitReceived',
    })
    if (!event) return null
    return this._record(event)
  }

  /**
   * Ozalit twin of demoNotReceived. Wipes the approval ledger because a
   * fresh physical proof needs everyone's sign-off again.
   *
   * ctx: { designerIds }
   */
  ozalitNotReceived(actor, ctx = {}) {
    const event = runFsm(this, computeOzalitNotReceived, [actor, ctx], 'project.ozalit_not_received', {
      kind: 'transition',
    })
    if (!event) return null
    return this._record(event)
  }

  /** Matbaa "Başladım" — flag-only, no stage change. Idempotent. */
  demoStart(actor) {
    const event = runFsm(this, computeDemoStart, [actor], 'project.demo_started', {
      kind: 'demoStarted',
    })
    if (!event) return null
    return this._record(event)
  }

  /** Ozalit twin of demoStart. Same idempotency, same flag-only semantics. */
  ozalitStart(actor) {
    const event = runFsm(this, computeOzalitStart, [actor], 'project.ozalit_started', {
      kind: 'ozalitStarted',
    })
    if (!event) return null
    return this._record(event)
  }

  /**
   * Cancel a not-yet-started demo outright — back to tasarim, no
   * demo_attempt bump (nothing was delivered).
   *
   * ctx: { designerIds }
   */
  demoCancel(actor, ctx = {}) {
    const event = runFsm(this, computeDemoCancel, [actor, ctx], 'project.demo_cancelled', {
      kind: 'demoCancelled',
    })
    if (!event) return null
    return this._record(event)
  }

  /** Ozalit twin of demoCancel. Same flag-reset, no attempt bump. */
  ozalitCancel(actor) {
    const event = runFsm(this, computeOzalitCancel, [actor], 'project.ozalit_cancelled', {
      kind: 'ozalitCancelled',
    })
    if (!event) return null
    return this._record(event)
  }

  /**
   * Leader edited the demo form while it sits with the matbaa (free-edit
   * window). Logs history + notifies the matbaa; clears any pending
   * "fix owed" flag.
   *
   * ctx: { designerIds, demoId }
   */
  demoEdit(actor, ctx = {}) {
    const event = runFsm(this, computeDemoEdit, [actor, ctx], 'project.demo_form_edited', {
      kind: 'demoEdited',
    })
    if (!event) return null
    return this._record(event)
  }

  /** Ozalit twin of demoEdit. Same free-edit window. */
  ozalitEdit(actor, ctx = {}) {
    const event = runFsm(this, computeOzalitEdit, [actor, ctx], 'project.ozalit_form_edited', {
      kind: 'ozalitEdited',
    })
    if (!event) return null
    return this._record(event)
  }

  /**
   * Ask the matbaa to accept a cancel/edit once they've started work.
   * Refused when the round isn't started — the free-edit path above is
   * used instead.
   *
   * ctx: { designerIds, note }
   */
  demoChangeRequest(actor, ctx = {}) {
    const event = runFsm(
      this,
      computeDemoChangeRequest,
      [actor, { note: ctx.note }, ctx],
      'project.demo_change_requested',
      { kind: 'demoChangeRequested', note: ctx.note ?? '' },
    )
    if (!event) return null
    return this._record(event)
  }

  /** Ozalit twin of demoChangeRequest. */
  ozalitChangeRequest(actor, ctx = {}) {
    const event = runFsm(
      this,
      computeOzalitChangeRequest,
      [actor, { note: ctx.note }, ctx],
      'project.ozalit_change_requested',
      { kind: 'ozalitChangeRequested', note: ctx.note ?? '' },
    )
    if (!event) return null
    return this._record(event)
  }

  /**
   * Matbaa accepts a pending change request — un-starts the round and
   * marks a fix owed before the matbaa can re-lock it.
   */
  demoChangeAccept(actor) {
    const event = runFsm(this, computeDemoChangeAccept, [actor], 'project.demo_change_accepted', {
      kind: 'demoChangeAccepted',
    })
    if (!event) return null
    return this._record(event)
  }

  /** Matbaa declines a pending change request — round stays started. */
  demoChangeDecline(actor) {
    const event = runFsm(this, computeDemoChangeDecline, [actor], 'project.demo_change_declined', {
      kind: 'demoChangeDeclined',
    })
    if (!event) return null
    return this._record(event)
  }

  /** Ozalit twin of demoChangeAccept. */
  ozalitChangeAccept(actor) {
    const event = runFsm(this, computeOzalitChangeAccept, [actor], 'project.ozalit_change_accepted', {
      kind: 'ozalitChangeAccepted',
    })
    if (!event) return null
    return this._record(event)
  }

  /** Ozalit twin of demoChangeDecline. */
  ozalitChangeDecline(actor) {
    const event = runFsm(this, computeOzalitChangeDecline, [actor], 'project.ozalit_change_declined', {
      kind: 'ozalitChangeDeclined',
    })
    if (!event) return null
    return this._record(event)
  }

  /**
   * Prepare the Baskı Onay Formu (migration 045). No stage change; the
   * later approve branch requires a DIFFERENT team leader than the
   * preparer, unless the preparer is the only active one.
   */
  baskiOnayPrepare(actor) {
    const event = runFsm(this, computeBaskiOnayPrepare, [actor], 'project.baski_onay_prepared', {
      kind: 'baskiOnayPrepared',
    })
    if (!event) return null
    return this._record(event)
  }

  /**
   * Reject a project. Sends it back to tasarim (designer target) or to
   * the matbaa's teslim stage (re-delivery lock). For the designer
   * route, mutates subtasks in-place and carries them on the event so
   * the service writes them in the same tx.
   *
   * ctx: { reason, rejectTarget, revizeIds }
   */
  reject(actor, ctx = {}) {
    const isMatbaaTarget = ctx.rejectTarget === 'matbaa'
    const result = computeRejection(
      this,
      ctx.reason,
      ctx.revizeIds ?? [],
      ctx.rejectTarget ?? null,
      { actorName: actor?.name ?? 'Bilinmeyen', actor },
    )
    if (!result || result.history === null) return null
    Object.assign(this, result.project)
    return this._record({
      type: 'project.rejected',
      projectHistory: result.history,
      notification: {
        kind: 'transition',
      },
      // Only the designer route actually mutates subtasks. The matbaa
      // route leaves them alone (same values as before reject), so the
      // service's `after` hook has nothing to write — `updatedSubtasks`
      // being null is the signal that skips the loop.
      updatedSubtasks: isMatbaaTarget ? null : (result.project.subtasks ?? null),
    })
  }
}