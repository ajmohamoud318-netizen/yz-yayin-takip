/**
 * Application service for the sipariş (order) workflow.
 *
 * Owns everything the `Order` entity deliberately refuses to:
 *   - transactions and row locking,
 *   - persistence (via `order-repository.js`),
 *   - cross-aggregate writes (project timeline, project stage,
 *     `order_subtasks.needs_revize`),
 *   - notifications.
 *
 * The shape of every mutating command is the same and lives in
 * `runOrderCommand`: lock the row, rebuild the entity, let the entity decide
 * and mutate itself, then persist exactly what it changed and translate the
 * event it returned into side effects. Routes call these functions and
 * return the result verbatim.
 */

import { withTx } from '../db/pool.js'
import { badRequest, forbidden, notFound } from '../domain/errors.js'
import { Order } from '../domain/entities/Order.js'
import { assertOrderable, isAtOrPastStage } from '../domain/pipeline.js'
import {
  getProject, getProjectForUpdate, patchProject, logHistory, insertDemoSnapshot,
} from './project-repository.js'
import {
  notifyOrderTransition, notifyOrderRejected, notifyMatbaaReceived, notifyMatbaaApprovalPending,
  notifyOrderOzalitStarted, notifyOrderOzalitCancelled, notifyOrderOzalitEdited,
  notifyOrderOzalitChangeRequested, notifyOrderOzalitChangeAccepted, notifyOrderOzalitChangeDeclined,
} from './notifications.js'
import * as repo from './order-repository.js'

// Columns `runOrderCommand` never diffs: the repository bumps `version` and
// `updated_at` in SQL, and `payload` is immutable after creation.
const NON_DIFFED_COLUMNS = new Set(['version', 'updated_at', 'payload'])

/**
 * The columns the entity actually changed, by comparing it against the row
 * it was built from. Objects and arrays are compared structurally because
 * the entity always replaces them wholesale rather than mutating in place.
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
 * An idempotent no-op (a second "Teslim Alındı" click, a second "Başladım")
 * answers with the untouched row. `payload` is stripped to match the shape
 * every other order response carries — the pre-refactor routes did exactly
 * this, and the SPA reads the flattened `items`/`quantity`/`notes` instead.
 */
function withoutPayload(row) {
  const { payload, ...rest } = row
  return rest
}

/**
 * Fire the notification an event asked for. Recipient selection lives in
 * `notifications.js`; this only routes the event to the right function.
 */
async function dispatchNotification(client, { notification, order, project, actor, requesterId }) {
  if (!notification) return
  const base = { order, project, actor }
  switch (notification.kind) {
    case 'transition':
      return notifyOrderTransition(client, {
        ...base, newStatus: notification.destination, requesterId,
        assigneeIds: notification.assigneeIds ?? [],
      })
    case 'matbaaApprovalPending':
      return notifyMatbaaApprovalPending(client, {
        ...base, teamLeaderIds: notification.teamLeaderIds, designerIds: notification.designerIds,
      })
    case 'matbaaReceived':
      return notifyMatbaaReceived(client, { ...base, assigneeIds: notification.assigneeIds ?? [] })
    case 'ozalitStarted':
      return notifyOrderOzalitStarted(client, base)
    case 'ozalitCancelled':
      return notifyOrderOzalitCancelled(client, base)
    case 'ozalitEdited':
      return notifyOrderOzalitEdited(client, base)
    case 'ozalitChangeRequested':
      return notifyOrderOzalitChangeRequested(client, { ...base, note: notification.note })
    case 'ozalitChangeAccepted':
      return notifyOrderOzalitChangeAccepted(client, base)
    case 'ozalitChangeDeclined':
      return notifyOrderOzalitChangeDeclined(client, base)
    case 'rejected':
      // Two pings: the sales requester learns it bounced, and whoever owns
      // the step it was sent back to learns they have work.
      await notifyOrderRejected(client, { ...base, requesterId, reason: notification.reason })
      return notifyOrderTransition(client, {
        ...base, newStatus: notification.destination, requesterId,
        assigneeIds: Array.isArray(order.assignee_ids) ? order.assignee_ids : [],
      })
    case 'finalApproved':
      return notifyOrderTransition(client, { ...base, newStatus: 'onaylandi', requesterId })
    default:
      return undefined
  }
}

/**
 * Run one entity command end-to-end inside a transaction.
 *
 * @param {string} orderId
 * @param {object} actor — request.user
 * @param {object} hooks
 * @param {function} [hooks.prepare] — async ({ client, row }) => ctx; loads
 *   whatever the entity needs from other tables before it decides.
 * @param {function} hooks.run — (order, ctx) => domain event | null
 * @param {function} [hooks.after] — async ({ client, event, updated, ctx, loadProject });
 *   cross-aggregate work that must happen before the timeline is written.
 *   May mutate `event.projectHistories`.
 * @param {object} [client] — an already-open transaction to run inside. The
 *   routes never pass one (each request is its own transaction); the service
 *   tests use it to drive a fake pg client through this exact orchestration.
 */
async function runOrderCommand(orderId, actor, { prepare, run, after } = {}, client = null) {
  const body = async (client) => {
    const row = await repo.lockOrder(client, orderId)
    if (!row) notFound('Talep bulunamadı.')

    const before = { ...row }
    const order = new Order(row)
    const ctx = prepare ? await prepare({ client, row: before }) : {}

    const event = await run(order, ctx)
    // Idempotent no-op — nothing to persist, log or announce.
    if (!event) return withoutPayload(before)

    const updated = await repo.updateOrder(client, orderId, changedFields(before, order), before.version)
    if (event.orderHistory) {
      await repo.insertOrderHistory(client, {
        orderId,
        step: event.orderHistory.step,
        signedById: actor?.id ?? null,
        note: event.orderHistory.note ?? '',
        demoId: event.orderHistory.demoId ?? null,
      })
    }

    // Memoized so a hook that needs the project and the timeline writes that
    // follow it share one locking read, in the order the routes always used.
    let projectPromise
    const loadProject = () => (projectPromise ??= getProjectForUpdate(client, before.project_id))

    if (after) await after({ client, event, updated, ctx, loadProject, actor })

    const needsProject = event.projectHistories?.length > 0 || event.notification
    const project = needsProject ? await loadProject() : null

    // A deleted project can't carry a timeline; the notification still goes
    // out (it falls back to the order's own title).
    if (project) {
      for (const entry of event.projectHistories ?? []) {
        await logHistory(client, {
          project_id: project.id,
          from_stage: project.stage,
          to_stage: entry.to_stage ?? project.stage,
          action: entry.action,
          event: entry.event,
          note: entry.note,
          reason: entry.reason,
          reject_target: entry.rejectTarget,
          demo_id: entry.demoId ?? null,
        }, actor)
      }
    }

    await dispatchNotification(client, {
      notification: event.notification,
      order: updated,
      project,
      actor,
      requesterId: before.requested_by,
    })

    return updated
  }
  return client ? body(client) : withTx(body)
}

/**
 * GET /api/order-requests — every order, hydrated.
 *
 * `items`/`quantity`/`notes` are flattened out of the JSONB `payload` here
 * rather than in every consumer, and the order's own alt görev snapshot is
 * exposed as `subtasks` so the SPA reads it exactly as it used to read
 * `project.subtasks`.
 */
export async function listOrders(db) {
  const rows = await repo.listOrders(db)
  return rows.map(({ row, history, subtasks }) => {
    const { payload, ...rest } = row
    return {
      ...rest,
      items: payload?.items ?? [],
      quantity: payload?.quantity ?? null,
      notes: payload?.notes ?? '',
      subtasks,
      order_history: history.map((h) => ({
        step: h.step,
        notes: h.notes,
        demo_id: h.demo_id ?? null,
        signed_by_id: h.signed_by_id,
        signed_by_name: h.signed_by_name,
        signed_by_role: h.signed_by_role,
        signed_at: h.created_at,
        created_at: h.created_at,
      })),
      version: row.version,
    }
  })
}

/**
 * POST /api/order-requests — satış raises a print request against a
 * catalog-listed product. Creation has no entity command: there is no prior
 * state to guard, only the project's orderability.
 */
export async function createOrder(actor, { projectId, payload = {}, items = [], quantity, notes }) {
  if (actor?.role !== 'satis') forbidden('Yalnızca satış baskı oluşturabilir.')
  const project = await getProject(projectId)
  if (!project) notFound('Proje bulunamadı.')
  assertOrderable(project)

  const merged = { ...payload, items, quantity, notes: notes ?? payload.notes ?? '' }

  return withTx(async (client) => {
    const order = await repo.insertOrder(client, {
      projectId, requestedBy: actor.id, payload: merged,
    })
    await repo.snapshotProjectSubtasks(client, order.id, projectId)
    await repo.insertOrderHistory(client, {
      orderId: order.id, step: 'pending', signedById: actor.id, note: notes ?? '',
    })
    await logHistory(client, {
      project_id: projectId,
      from_stage: project.stage,
      to_stage: project.stage,
      action: 'system',
      event: 'order_request',
      note: 'Baskı talebi oluşturuldu',
    }, actor)
    // New talep at 'pending' → the team leader must act on it.
    await notifyOrderTransition(client, {
      order, project, newStatus: 'pending', actor, requesterId: order.requested_by,
    })
    return order
  })
}

/**
 * PATCH /api/order-requests/:id/advance.
 *
 * The entity owns the FSM; this loads the two things it can't see for
 * itself — the active team leader set for a multi-party matbaa_onay round,
 * and whether the chosen assignees are real, active designers.
 */
export async function advanceOrder(orderId, actor, {
  notes = '', assignees = null, expectedVersion = null, route = null,
} = {}, client = null) {
  // An empty array is treated as "not supplied", the way the pre-refactor
  // route's `assignees.length > 0` test did — only a non-empty list can
  // reassign an order or steer a transition notification.
  const chosenAssignees = Array.isArray(assignees) && assignees.length > 0 ? assignees : null

  return runOrderCommand(orderId, actor, {
    async prepare({ client, row }) {
      const wasPending = row.status === 'pending'
      // The active leader set is only consulted by a multi-party matbaa_onay
      // round, so it stays unqueried for every other step.
      if (row.status !== 'matbaa_onay') return { wasPending }
      return {
        wasPending,
        teamLeaderIds: await repo.activeTeamLeaderIds(client),
        designerIds: Array.isArray(row.assignee_ids) ? row.assignee_ids : [],
      }
    },
    run: (order, ctx) => order.advance(actor, {
      notes,
      assignees: chosenAssignees,
      expectedVersion,
      route,
      teamLeaderIds: ctx.teamLeaderIds ?? [],
      designerIds: ctx.designerIds ?? [],
    }),
    async after({ client, ctx }) {
      // Only the pending → goruldu handoff carries assignees. Validated
      // after the entity's state/role gates so a caller sees the same error
      // the route used to produce, and inside the transaction so a bad id
      // rolls the whole advance back.
      if (!ctx.wasPending) return
      for (const id of chosenAssignees ?? []) {
        const user = await repo.findUser(client, id)
        if (!user) badRequest(`Tasarımcı bulunamadı: ${id}`)
        if (user.role !== 'designer') badRequest('Seçilen kullanıcı tasarımcı değil.')
        if (user.is_active === false) badRequest('Tasarımcı pasif durumda, atanamaz.')
      }
    },
  }, client)
}

/** POST /api/order-requests/:id/matbaa-receive */
export async function receiveMatbaaOzalit(orderId, actor, client = null) {
  return runOrderCommand(orderId, actor, {
    prepare: ({ row }) => ({
      designerIds: Array.isArray(row.assignee_ids) ? row.assignee_ids : [],
    }),
    run: (order, ctx) => order.receiveMatbaaOzalit(actor, ctx),
  }, client)
}

/** POST /api/order-requests/:id/matbaa-not-received */
export async function markMatbaaNotReceived(orderId, actor, client = null) {
  return runOrderCommand(orderId, actor, {
    prepare: ({ row }) => ({
      designerIds: Array.isArray(row.assignee_ids) ? row.assignee_ids : [],
    }),
    run: (order, ctx) => order.markMatbaaNotReceived(actor, ctx),
  }, client)
}

/** POST /api/order-requests/:id/ozalit-start */
export async function startOzalit(orderId, actor, client = null) {
  return runOrderCommand(orderId, actor, { run: (order) => order.startOzalit(actor) }, client)
}

/** POST /api/order-requests/:id/ozalit-cancel */
export async function cancelOzalit(orderId, actor, client = null) {
  return runOrderCommand(orderId, actor, { run: (order) => order.cancelOzalit(actor) }, client)
}

/**
 * POST /api/order-requests/:id/ozalit-edit-notify
 *
 * The corrected sheet is written in the same transaction that authorizes the
 * correction, so a refused edit leaves nothing behind: if `editOzalit`
 * throws, the snapshot INSERT rolls back with it.
 */
export async function editOzalit(orderId, actor, { payload, attempt } = {}, client = null) {
  return runOrderCommand(orderId, actor, {
    async prepare({ client, row }) {
      if (!payload) return { demoId: null }
      const snapshot = await insertDemoSnapshot(client, {
        project_id: row.project_id,
        order_id: orderId,
        kind: 'ozalit',
        payload,
        attempt: attempt ?? (row.ozalit_attempt ?? 0) + 1,
        created_by: actor?.id,
      })
      return { demoId: snapshot?.id ?? null }
    },
    run: (order, ctx) => order.editOzalit(actor, ctx),
  }, client)
}

/** POST /api/order-requests/:id/ozalit-change-request */
export async function requestOzalitChange(orderId, actor, { note } = {}, client = null) {
  return runOrderCommand(orderId, actor, {
    run: (order) => order.requestOzalitChange(actor, { note }),
  }, client)
}

/** POST /api/order-requests/:id/ozalit-change-accept */
export async function acceptOzalitChange(orderId, actor, client = null) {
  return runOrderCommand(orderId, actor, { run: (order) => order.acceptOzalitChange(actor) }, client)
}

/** POST /api/order-requests/:id/ozalit-change-decline */
export async function declineOzalitChange(orderId, actor, client = null) {
  return runOrderCommand(orderId, actor, { run: (order) => order.declineOzalitChange(actor) }, client)
}

/**
 * PATCH /api/order-requests/:id/reject
 *
 * The entity decides the target status and resets the round; flagging the
 * named alt görevler is a different aggregate's write, so it happens here —
 * and its result feeds the timeline note, which names the görev TITLES the
 * leader picked, not their ids.
 */
export async function rejectOrder(orderId, actor, { reason, rejectTarget = 'matbaa', revizeIds = [] } = {}, client = null) {
  return runOrderCommand(orderId, actor, {
    run: (order) => order.reject(actor, { reason, rejectTarget, revizeIds }),
    async after({ client, event }) {
      // Only the 'designer' route reworks the design: a 'matbaa' rejection
      // re-delivers the same files, and 'reassign' hands the order to a new
      // team. needs_revize is set and is_done / progress left alone — the
      // work was done, it only needs a touch-up.
      const flagging = rejectTarget === 'designer' && revizeIds.length > 0
      const titles = flagging
        ? await repo.flagSubtasksForRevize(client, orderId, revizeIds)
        : []
      // The note names the görev TITLES actually flagged. Composed here
      // rather than in the entity for both halves of that: the titles come
      // from the order_subtasks write above (a different aggregate), and
      // ids that flagged nothing — a 'matbaa' rejection, or an id from
      // another order — must not appear in the timeline at all.
      for (const entry of event.projectHistories) {
        entry.note = titles.length > 0
          ? `Baskı reddedildi (${rejectTarget}), revize: ${titles.join(', ')}`
          : `Baskı reddedildi (${rejectTarget})`
      }
    },
  }, client)
}

/**
 * PATCH /api/order-requests/:id/baski-onay-form — quiet draft save.
 * Partial-friendly on purpose: unlike the approve route below it does not
 * require the mandatory fields to be filled in yet. `notes` is part of the
 * saved draft here (the approve route treats notes as a history comment).
 */
export async function saveBaskiOnayForm(orderId, actor, {
  components, adet, tarih, basimYeri, hazirlayan, notes,
} = {}, client = null) {
  return runOrderCommand(orderId, actor, {
    run: (order) => order.saveBaskiOnayForm(actor, {
      components, adet, tarih, basimYeri, hazirlayan, notes,
    }),
  }, client)
}

/**
 * POST /api/order-requests/:id/baski-onay-approve — the only route that can
 * move an order to onaylandi.
 *
 * The project stage flip is forward-only: a second concurrent order on the
 * same project can finish after the project has already moved past baskida
 * (via the first order, or via the main pipeline) and must not regress it.
 */
export async function approveBaskiOnayForm(orderId, actor, {
  components, adet, tarih, basimYeri, hazirlayan, notes = '',
} = {}, client = null) {
  return runOrderCommand(orderId, actor, {
    run: (order) => order.approveBaskiOnayForm(actor, {
      form: { components, adet, tarih, basimYeri, hazirlayan }, notes,
    }),
    async after({ client, event, loadProject }) {
      const project = await loadProject()
      if (!project) return
      if (!isAtOrPastStage(project, 'baskida')) {
        await patchProject(client, project.id, { stage: 'baskida' })
        event.projectHistories = [{
          event: 'order_final', action: 'system',
          to_stage: 'baskida', note: 'Baskı onaylandı, baskıya alındı',
        }]
      } else {
        event.projectHistories = [{
          event: 'order_final', action: 'system',
          note: 'Baskı onaylandı (proje zaten baskıda veya sonrasında)',
        }]
      }
    },
  }, client)
}

/**
 * PATCH /api/order-requests/:orderId/subtasks/:id — toggle one row of this
 * order's own alt görev snapshot. Gated on `order.assignee_ids` (an order can
 * have several designers) rather than a per-row `assigned_to`.
 */
export async function patchOrderSubtask(orderId, subtaskId, actor, body, client = null) {
  const run = async (client) => {
    const row = await repo.lockOrderForSubtaskPatch(client, orderId)
    if (!row) notFound('Talep bulunamadı.')
    const subtask = await repo.lockOrderSubtask(client, orderId, subtaskId)
    if (!subtask) notFound('Alt görev bulunamadı.')

    const allowed = new Order(row).validateSubtaskUpdate(subtask, body, actor)
    return repo.updateOrderSubtask(client, subtask.id, allowed)
  }
  return client ? run(client) : withTx(run)
}
