/**
 * Notifications service.
 *
 * The single place that decides WHO gets told WHAT when project / order /
 * handover state changes. Called from the transition routes inside the same
 * `withTx` client that wrote the `stage_history` row, so a notification is
 * committed iff the state change it describes is committed — no more
 * client-side diffing / guessing.
 *
 * Design:
 *  • `emit()` is the low-level primitive: fan a single event out to a set of
 *    recipient user ids (deduped, actor removed) as one row each.
 *  • The `notify*` helpers encode the role/assignment rules that used to live
 *    (twice, and drifting) in the client's NotificationSync + buildNotifications.
 *    Now they live here once, event-driven.
 *
 * Recipients are resolved against the CURRENT active user set, so a
 * deactivated user never accrues a feed and "all team leaders" always means
 * the live ones.
 */

import { loadProjectAssignees } from './project-repository.js'
import { ORDER_STEP_OWNER } from '../domain/orders.js'

/** Active user ids for the given role(s). */
export async function activeUserIdsByRole(client, ...roles) {
  if (roles.length === 0) return []
  const { rows } = await client.query(
    `SELECT id FROM users WHERE role = ANY($1) AND is_active = TRUE`,
    [roles],
  )
  return rows.map((r) => r.id)
}

/**
 * Low-level fan-out. Inserts one notification row per recipient.
 *
 *  recipientIds  array of user ids (may contain dups / the actor / nulls —
 *                all are cleaned here)
 *  actorId       who caused the event; removed from recipients so you never
 *                get pinged for your own action
 *
 * Returns the number of rows written.
 */
export async function emit(client, {
  recipientIds = [],
  actorId = null,
  type,
  title = '',
  body = '',
  tone = 'blue',
  projectId = null,
  orderId = null,
  link = null,
}) {
  const clean = [...new Set(recipientIds.filter(Boolean))].filter((id) => id !== actorId)
  if (clean.length === 0) return 0

  // Multi-row parameterised insert: one ($n,…) tuple per recipient.
  const cols = '(user_id, type, title, body, tone, project_id, order_id, link, actor_id)'
  const tuples = []
  const values = []
  clean.forEach((uid, i) => {
    const b = i * 9
    tuples.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`)
    values.push(uid, type, title, body, tone, projectId, orderId, link, actorId)
  })
  await client.query(`INSERT INTO notifications ${cols} VALUES ${tuples.join(',')}`, values)
  return clean.length
}

/* --------------------------- project pipeline ---------------------------- */

/** New project created → tell the assigned designer(s). */
export async function notifyProjectCreated(client, { project, actor, assignees }) {
  const designerIds = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  return emit(client, {
    recipientIds: designerIds,
    actorId: actor?.id,
    type: 'assignment',
    title: project.title,
    body: 'Yeni proje atandı',
    tone: 'green',
    projectId: project.id,
    link: `/projects/${project.id}`,
  })
}

/**
 * A project pipeline transition (advance / approve / reject) just committed.
 * `toStage` / `fromStage` / `action` come straight from the history row the
 * route already built. We map the resulting state to the people who now need
 * to know — and skip the actor.
 *
 * `assignees` may be passed by callers that already loaded it (advance /
 * approve / receive routes do); otherwise we resolve it here (reject route).
 */
export async function notifyProjectTransition(client, {
  project, fromStage, toStage, action, actor, assignees,
}) {
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  const printers = await activeUserIdsByRole(client, 'printer')
  const sales = await activeUserIdsByRole(client, 'satis')
  const base = { actorId: actor?.id, title: project.title, projectId: project.id }

  // Rejection back to Tasarım → the designer has to rework.
  if (action === 'reject' && toStage === 'tasarim') {
    return emit(client, {
      ...base, recipientIds: designers, type: 'rejection', tone: 'rose',
      body: 'Revizyon gerekiyor — tasarıma geri döndü', link: `/projects/${project.id}`,
    })
  }

  switch (toStage) {
    // Matbaa must deliver the requested demo.
    case 'demo_teslim':
    case 'cin_demo_teslim':
      return emit(client, {
        ...base, recipientIds: printers, type: 'demo_delivery_pending', tone: 'blue',
        body: 'Demo teslimi bekleniyor', link: `/projects/${project.id}`,
      })

    // Demo delivered → leader + assigned designers review/approve.
    case 'demo_onay':
    case 'cin_demo_onay':
      return emit(client, {
        ...base, recipientIds: [...leaders, ...designers], type: 'demo_approval_pending', tone: 'amber',
        body: 'Demo onayınızı bekliyor', link: `/projects/${project.id}`,
      })

    // Reaching ozalit_teslim: either the demo was just approved (designer may
    // now request ozalit), the designer requested ozalit (matbaa must
    // deliver), or a reject/not-received sent it back locked to the matbaa
    // for redelivery (no fresh request needed — same as demo's teslim case).
    case 'ozalit_teslim':
      if (project.ozalit_requested || project.reject_target === 'matbaa') {
        return emit(client, {
          ...base, recipientIds: printers, type: 'ozalit_delivery_pending', tone: 'blue',
          body: 'Ozalit teslimi bekleniyor', link: `/projects/${project.id}`,
        })
      }
      return emit(client, {
        ...base, recipientIds: designers, type: 'ozalit_requestable', tone: 'blue',
        body: 'Demo onaylandı — ozalit isteyebilirsiniz', link: `/projects/${project.id}`,
      })

    // Ozalit delivered → leader + assigned designers approve.
    case 'ozalit_onay':
      return emit(client, {
        ...base, recipientIds: [...leaders, ...designers], type: 'ozalit_approval_pending', tone: 'amber',
        body: 'Ozalit onayınızı bekliyor', link: `/projects/${project.id}`,
      })

    // Production ready → matbaa can take it in.
    case 'uretime_hazir':
      return emit(client, {
        ...base, recipientIds: [...printers, ...leaders], type: 'production_ready', tone: 'green',
        body: 'Üretime hazır', link: '/uretime-hazir',
      })

    case 'uretimde':
      return emit(client, {
        ...base, recipientIds: [...leaders, ...designers], type: 'in_production', tone: 'green',
        body: 'Üretime alındı', link: `/projects/${project.id}`,
      })

    case 'gumruk':
      return emit(client, {
        ...base, recipientIds: leaders, type: 'in_customs', tone: 'blue',
        body: 'Gümrük aşamasında', link: `/projects/${project.id}`,
      })

    case 'satista':
      return emit(client, {
        ...base, recipientIds: [...leaders, ...designers, ...sales], type: 'on_sale', tone: 'pink',
        body: 'Satışa çıktı 🎉', link: `/projects/${project.id}`,
      })

    default:
      return 0
  }
}

/* ------------------------------- orders ---------------------------------- */

const ORDER_STEP_BODY = {
  pending: 'Yeni sipariş talebi — onayınızı bekliyor',
  goruldu: 'Sipariş kontrolünüzü bekliyor',
  tasarimci_onay: 'Sipariş ozalit isteniyor',
  matbaa_onay: 'Sipariş ozalit onayınızı bekliyor',
}
const ORDER_STEP_LINK = {
  pending: '/siparis-talepleri',
  goruldu: '/siparis-onay',
  tasarimci_onay: '/approvals/siparis',
  matbaa_onay: '/siparis-talepleri',
}
const ORDER_STEP_TONE = {
  pending: 'amber', goruldu: 'green', tasarimci_onay: 'blue', matbaa_onay: 'amber',
}

/**
 * A sipariş (order) moved to `newStatus`. Notify whoever must act on that
 * step. `onaylandi` is terminal → the sales requester is told it's approved.
 * `assigneeIds` are the designers assigned to THIS order (so the 'goruldu'
 * step pings the right designers, not every designer).
 */
export async function notifyOrderTransition(client, {
  order, project, newStatus, actor, requesterId, assigneeIds = [],
}) {
  const title = project?.title ?? order?.project_title ?? 'Sipariş'
  const base = { actorId: actor?.id, title, projectId: order?.project_id ?? project?.id, orderId: order?.id }

  if (newStatus === 'onaylandi') {
    return emit(client, {
      ...base, recipientIds: [requesterId], type: 'order_approved', tone: 'green',
      body: 'Talebiniz onaylandı — üretime alındı', link: '/siparis-talebi',
    })
  }

  const owner = ORDER_STEP_OWNER[newStatus]
  if (!owner) return 0
  // The designer step targets the order's assigned designers specifically;
  // every other step targets all active holders of the owner role.
  const recipientIds = owner === 'designer' && assigneeIds.length > 0
    ? assigneeIds
    : await activeUserIdsByRole(client, owner)

  return emit(client, {
    ...base, recipientIds, type: 'order_step', tone: ORDER_STEP_TONE[newStatus] ?? 'blue',
    body: ORDER_STEP_BODY[newStatus] ?? 'Sipariş güncellendi', link: ORDER_STEP_LINK[newStatus] ?? '/siparis-talepleri',
  })
}

/** Order rejected → tell the sales requester it bounced. */
export async function notifyOrderRejected(client, { order, project, actor, requesterId, reason }) {
  return emit(client, {
    actorId: actor?.id,
    recipientIds: [requesterId],
    type: 'order_rejected',
    title: project?.title ?? order?.project_title ?? 'Sipariş',
    body: reason ? `Sipariş reddedildi: ${reason}` : 'Sipariş reddedildi',
    tone: 'rose',
    projectId: order?.project_id ?? project?.id,
    orderId: order?.id,
    link: '/siparis-talebi',
  })
}

/* ------------------------------ handovers -------------------------------- */

/** Matbaa raised a teslim → tell sales to confirm receipt. */
export async function notifyHandoverRequested(client, { project, actor }) {
  const sales = await activeUserIdsByRole(client, 'satis')
  return emit(client, {
    recipientIds: sales, actorId: actor?.id, type: 'handover_request', tone: 'amber',
    title: project.title, body: 'Teslim talebi — onayınızı bekliyor',
    projectId: project.id, link: '/teslim-onaylari',
  })
}

/** Sales confirmed receipt → tell the matbaa who raised it + leaders + designers. */
export async function notifyHandoverConfirmed(client, { project, actor, raisedBy, assignees }) {
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  return emit(client, {
    recipientIds: [raisedBy, ...leaders, ...designers], actorId: actor?.id,
    type: 'handover_confirmed', tone: 'pink',
    title: project.title, body: 'Teslim onaylandı — satışa çıktı 🎉',
    projectId: project.id, link: `/projects/${project.id}`,
  })
}

/* ------------------------------- queries --------------------------------- */

export async function listForUser(client, userId, { limit = 50 } = {}) {
  const { rows } = await client.query(
    `SELECT id, type, title, body, tone, project_id, order_id, link,
            is_read, read_at, seen, seen_at, created_at
       FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC, id
      LIMIT $2`,
    [userId, limit],
  )
  return rows
}

/**
 * Mark one notification read — scoped to the owner. Reading implies seeing,
 * so we set `seen` too (keeps the is_read ⇒ seen invariant).
 */
export async function markRead(client, userId, id) {
  const { rowCount } = await client.query(
    `UPDATE notifications
        SET is_read = TRUE, read_at = NOW(),
            seen = TRUE, seen_at = COALESCE(seen_at, NOW())
      WHERE id = $1 AND user_id = $2 AND is_read = FALSE`,
    [id, userId],
  )
  return rowCount > 0
}

/** Mark every row read (and therefore seen). Returns rows affected. */
export async function markAllRead(client, userId) {
  const { rowCount } = await client.query(
    `UPDATE notifications
        SET is_read = TRUE, read_at = NOW(),
            seen = TRUE, seen_at = COALESCE(seen_at, NOW())
      WHERE user_id = $1 AND is_read = FALSE`,
    [userId],
  )
  return rowCount
}

/**
 * Mark every unseen row seen — called when the user OPENS the bell. Clears
 * the badge WITHOUT touching is_read, so items stay bold/to-do until acted on.
 */
export async function markAllSeen(client, userId) {
  const { rowCount } = await client.query(
    `UPDATE notifications SET seen = TRUE, seen_at = NOW()
      WHERE user_id = $1 AND seen = FALSE`,
    [userId],
  )
  return rowCount
}
