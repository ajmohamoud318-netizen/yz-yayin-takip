/**
 * Non-project domain notifications.
 *
 * Sibling to `notifications.js` (the orchestrator) and
 * `notifications-pipeline.js` (project events). This file owns the
 * sipariş (orders), toplantı (meetings), hedef proje (target project
 * ideas), and teslim (handover) notification paths — the four event
 * families that aren't tied to the project pipeline's stage FSM.
 *
 * Each `notifyXxx` is called from a tx client so a notification is
 * committed iff the state change it describes is committed.
 *
 * Uses the orchestrator's `emit()` for the row write + push fan-out;
 * the sipariş multi-party approval state machine lives in
 * `domain/orders.js` (ORDER_STEP_OWNER) and the orders routes use
 * these helpers to ping the right role at each transition.
 */

import { loadProjectAssignees } from './project-repository.js'
import { ORDER_STEP_OWNER } from '../domain/orders.js'
import { activeUserIdsByRole, emit } from './notifications.js'

/**
 * A new Hedef Proje idea was added on Baskı Listesi (migration
 * 036__target_project_ideas.sql). Only fires when the author isn't a team
 * leader — the leader is the one curating this list, so their own additions
 * need no ping; anyone else's does, since otherwise it's only noticed by
 * chance the next time the leader happens to open the page.
 */
export async function notifyTargetProjectIdeaCreated(client, { idea, actor }) {
  if (actor?.role === 'team_leader') return 0
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  return emit(client, {
    recipientIds: leaders,
    actorId: actor?.id,
    type: 'target_project_idea',
    title: idea.name,
    body: `${actor?.name ?? 'Ekipten biri'} yeni bir hedef proje ekledi`,
    tone: 'blue',
    link: '/baski-listesi',
    event: { type: 'target_project_idea.created', aggregateId: idea.id },
  })
}

/* ----------------------------- toplantılar --------------------------------- */

/**
 * A new meeting was logged (migration 040__meetings.sql). Only fires when
 * the author isn't a team leader, same reasoning as
 * notifyTargetProjectIdeaCreated — the leader is the one who most needs to
 * know a designer or printer scheduled/logged a meeting.
 */
export async function notifyMeetingCreated(client, { meeting, actor }) {
  if (actor?.role === 'team_leader') return 0
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  return emit(client, {
    recipientIds: leaders,
    actorId: actor?.id,
    type: 'meeting',
    title: meeting.title,
    body: `${actor?.name ?? 'Ekipten biri'} yeni bir toplantı ekledi`,
    tone: 'blue',
    link: '/toplanti',
    event: { type: 'meeting.created', aggregateId: meeting.id },
  })
}

/* ------------------------------- orders ---------------------------------- */

const ORDER_STEP_BODY = {
  pending: 'Yeni baskı talebi, onayınızı bekliyor',
  goruldu: 'Baskı kontrolünüzü bekliyor',
  kontrol_edildi: 'Baskı kontrolleri tamam, ozalit formunu gönderin',
  tasarimci_onay: 'Baskı ozalit isteniyor',
  ekran_onay: 'Ekran onayı bekleniyor',
  siparis_baski_onay: 'Baskı onay formu bekleniyor',
}
const ORDER_STEP_LINK = {
  pending: '/siparis-talepleri',
  goruldu: '/siparis-onay',
  kontrol_edildi: '/siparis-onay',
  tasarimci_onay: '/approvals/siparis',
  ekran_onay: '/siparis-talepleri',
  siparis_baski_onay: '/siparis-talepleri',
}
// Every value here MUST be one of notifications.tone's five allowed values
// (migration 022: amber/green/rose/blue/pink). A tone outside that set fails
// the CHECK constraint inside `emit`, which rolls back the WHOLE advance
// transaction — the order silently refuses to move and the client sees a bare
// 500. 'violet' sat here and did exactly that to every advance into
// siparis_baski_onay (the completing matbaa_onay approval and every ekran_onay
// approval). It only ever fired in production because `emit` short-circuits
// when the actor is the sole recipient — a single-team-leader dev DB never
// reaches the INSERT.
//
// siparis_baski_onay is amber for the same reason its project-pipeline twin
// `baski_onay_pending` is: it's a step that owes someone an action.
const ORDER_STEP_TONE = {
  pending: 'amber', goruldu: 'green', kontrol_edildi: 'green',
  tasarimci_onay: 'blue', ekran_onay: 'blue', siparis_baski_onay: 'amber',
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
  const title = project?.title ?? order?.project_title ?? 'Baskı'
  const base = { actorId: actor?.id, title, projectId: order?.project_id ?? project?.id, orderId: order?.id,
    event: { type: 'order.transition', aggregateId: order?.id } }

  if (newStatus === 'onaylandi') {
    return emit(client, {
      ...base, recipientIds: [requesterId], type: 'order_approved', tone: 'green',
      body: 'Talebiniz onaylandı, üretime alındı', link: '/siparis-talebi',
    })
  }

  // Matbaa just delivered the reprint's ozalit: nobody can approve it yet —
  // computeMatbaaOnayApproval refuses until "Teslim Alındı" is marked, and
  // that's the leader's OR an assigned designer's to give. Mirrors
  // notifyProjectTransition's `ozalit_receipt_pending` case. Split into two
  // emits (unlike that one) because the two audiences land on different
  // pages here — leaders review from /siparis-talepleri, designers from
  // /siparis-onay.
  if (newStatus === 'matbaa_onay') {
    const leaders = await activeUserIdsByRole(client, 'team_leader')
    const a = await emit(client, {
      ...base, recipientIds: leaders, type: 'matbaa_receipt_pending', tone: 'amber',
      body: 'Matbaa ozaliti teslim etti, "Teslim Alındı" bekleniyor', link: '/siparis-talepleri',
    })
    const b = await emit(client, {
      ...base, event: null, recipientIds: assigneeIds, type: 'matbaa_receipt_pending', tone: 'amber',
      body: 'Matbaa ozaliti teslim etti, "Teslim Alındı" bekleniyor', link: '/siparis-onay',
    })
    return a + b
  }

  const owner = ORDER_STEP_OWNER[newStatus]
  if (!owner) return 0
  // The designer step targets the order's assigned designers specifically;
  // every other step targets all active holders of the owner role.
  const recipientIds = owner === 'designer' && assigneeIds.length > 0
    ? assigneeIds
    : await activeUserIdsByRole(client, owner)

  // tasarimci_onay is the printer's own sign-off step. The queue at
  // /approvals/siparis normally makes them tap a card's "Teslim Edin" button
  // before TalepSignDialog opens; the printer works form-first, so the tap
  // should land straight in the form instead. Carrying the order id lets
  // Approvals.jsx open it on arrival — every other step's link is a plain
  // list page its owner (leader/designer) is expected to triage first.
  const link = newStatus === 'tasarimci_onay' && order?.id
    ? `/approvals/siparis?order=${order.id}`
    : (ORDER_STEP_LINK[newStatus] ?? '/siparis-talepleri')

  return emit(client, {
    ...base, recipientIds, type: 'order_step', tone: ORDER_STEP_TONE[newStatus] ?? 'blue',
    body: ORDER_STEP_BODY[newStatus] ?? 'Baskı güncellendi', link,
  })
}

/** Order rejected → tell the sales requester it bounced. */
export async function notifyOrderRejected(client, { order, project, actor, requesterId, reason }) {
  return emit(client, {
    actorId: actor?.id,
    recipientIds: [requesterId],
    type: 'order_rejected',
    title: project?.title ?? order?.project_title ?? 'Baskı',
    body: reason ? `Baskı reddedildi: ${reason}` : 'Baskı reddedildi',
    tone: 'rose',
    projectId: order?.project_id ?? project?.id,
    orderId: order?.id,
    link: '/siparis-talebi',
    event: { type: 'order.rejected', aggregateId: order?.id },
  })
}

/**
 * A delivered matbaa ozalit was just marked "Teslim Alındı" — the sipariş
 * twin of notifyOzalitReceived. Matbaa approval is multi-party but
 * leader-first: acknowledging the proof unblocks the team leaders, and the
 * order's assigned designers counter-sign after one of them approves
 * (computeMatbaaOnayApproval). Split into two emits since the audiences land
 * on different pages (see notifyOrderTransition's matbaa_onay case above).
 */
/**
 * Full parity with the main pipeline's demo/ozalit started/cancel/edit/
 * change-request notifications (migration 048/049), scoped to the order's
 * own ozalit round (tasarimci_onay). Only team_leader can cancel/edit/
 * request a change on this side (see domain/entities/Order.js), so — unlike the
 * main pipeline's leader+designer pings — these only ever target leaders.
 */
export async function notifyOrderOzalitStarted(client, { order, project, actor }) {
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  return emit(client, {
    actorId: actor?.id, title: project?.title ?? order?.project_title ?? 'Baskı',
    projectId: order?.project_id ?? project?.id, orderId: order?.id,
    recipientIds: leaders, type: 'order_ozalit_started', tone: 'blue',
    body: 'Matbaa ozalit çalışmasına başladı, iptal veya düzenleme artık değişiklik isteği gerektirir',
    link: '/siparis-talepleri',
    event: { type: 'order.ozalit_started', aggregateId: order?.id },
  })
}

/** A pending ozalit request was cancelled outright — tells the printers. */
export async function notifyOrderOzalitCancelled(client, { order, project, actor }) {
  const printers = await activeUserIdsByRole(client, 'printer')
  return emit(client, {
    actorId: actor?.id, title: project?.title ?? order?.project_title ?? 'Baskı',
    projectId: order?.project_id ?? project?.id, orderId: order?.id,
    recipientIds: printers, type: 'order_ozalit_cancelled', tone: 'rose',
    body: 'Baskı ozalit talebi iptal edildi, bekleyen işiniz kalmadı',
    link: '/approvals/siparis',
    event: { type: 'order.ozalit_cancelled', aggregateId: order?.id },
  })
}

/** The leader edited the spec while it's still sitting with the matbaa. */
export async function notifyOrderOzalitEdited(client, { order, project, actor }) {
  const printers = await activeUserIdsByRole(client, 'printer')
  return emit(client, {
    actorId: actor?.id, title: project?.title ?? order?.project_title ?? 'Baskı',
    projectId: order?.project_id ?? project?.id, orderId: order?.id,
    recipientIds: printers, type: 'order_ozalit_edited', tone: 'amber',
    body: 'Baskı ürün bilgileri güncellendi, yeni haliyle inceleyin',
    link: '/approvals/siparis',
    event: { type: 'order.ozalit_edited', aggregateId: order?.id },
  })
}

/** The leader asked the matbaa to accept a cancel/edit — tells the printers. */
export async function notifyOrderOzalitChangeRequested(client, { order, project, actor, note }) {
  const printers = await activeUserIdsByRole(client, 'printer')
  const who = actor?.name ?? 'Ekipten biri'
  return emit(client, {
    actorId: actor?.id, title: who,
    projectId: order?.project_id ?? project?.id, orderId: order?.id,
    recipientIds: printers, type: 'order_ozalit_change_requested', tone: 'amber',
    body: note
      ? `${project?.title ?? order?.project_title ?? 'Baskı'} için değişiklik istedi, not: ${note}, kabul veya red bekleniyor`
      : `${project?.title ?? order?.project_title ?? 'Baskı'} için değişiklik istedi, kabul veya red bekleniyor`,
    link: '/approvals/siparis',
    event: { type: 'order.ozalit_change_requested', aggregateId: order?.id },
  })
}

/** The matbaa accepted the pending change-request — free cancel/edit reopens. */
export async function notifyOrderOzalitChangeAccepted(client, { order, project, actor }) {
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  return emit(client, {
    actorId: actor?.id, title: project?.title ?? order?.project_title ?? 'Baskı',
    projectId: order?.project_id ?? project?.id, orderId: order?.id,
    recipientIds: leaders, type: 'order_ozalit_change_accepted', tone: 'green',
    body: 'Matbaa değişiklik talebinizi kabul etti, iptal veya düzenleme artık yapılabilir',
    link: '/siparis-talepleri',
    event: { type: 'order.ozalit_change_accepted', aggregateId: order?.id },
  })
}

/** The matbaa declined the pending change-request. */
export async function notifyOrderOzalitChangeDeclined(client, { order, project, actor }) {
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  return emit(client, {
    actorId: actor?.id, title: project?.title ?? order?.project_title ?? 'Baskı',
    projectId: order?.project_id ?? project?.id, orderId: order?.id,
    recipientIds: leaders, type: 'order_ozalit_change_declined', tone: 'rose',
    body: 'Matbaa değişiklik talebinizi reddetti, normal teslim süreci devam ediyor',
    link: '/siparis-talepleri',
    event: { type: 'order.ozalit_change_declined', aggregateId: order?.id },
  })
}

export async function notifyMatbaaReceived(client, { order, project, actor, assigneeIds = [] }) {
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  const who = actor?.name ?? 'Ekipten biri'
  const base = {
    actorId: actor?.id, title: who, projectId: order?.project_id ?? project?.id, orderId: order?.id,
    event: { type: 'order.matbaa_received', aggregateId: order?.id },
  }
  const a = await emit(client, {
    ...base, recipientIds: leaders, type: 'matbaa_approval_pending', tone: 'amber',
    body: `${project?.title ?? order?.project_title ?? 'Baskı'} ozaliti teslim alındı, onayınız bekleniyor`,
    link: '/siparis-talepleri',
  })
  const b = await emit(client, {
    ...base, event: null, recipientIds: assigneeIds, type: 'matbaa_received', tone: 'blue',
    body: `${project?.title ?? order?.project_title ?? 'Baskı'} ozaliti teslim alındı, ekip lideri onayı bekleniyor`,
    link: '/siparis-onay',
  })
  return a + b
}

/**
 * One party signed off on the matbaa ozalit but the round isn't complete —
 * ping whoever still owes an approval. Twin of the partial-approval branch in
 * notifyProjectTransition for ozalit_onay.
 */
export async function notifyMatbaaApprovalPending(client, { order, project, actor, teamLeaderIds = [], designerIds = [] }) {
  const approved = new Set((order?.matbaa_approvals ?? []).map((a) => a.id))
  const pendingLeaders = teamLeaderIds.filter((id) => !approved.has(id))
  const pendingDesigners = designerIds.filter((id) => !approved.has(id))
  const base = {
    actorId: actor?.id, title: project?.title ?? order?.project_title ?? 'Baskı',
    projectId: order?.project_id ?? project?.id, orderId: order?.id,
    type: 'matbaa_approval_pending', tone: 'amber',
    body: `${actor?.name ?? 'Ekipten biri'} baskı ozaliti onayladı, onayınız bekleniyor`,
    event: { type: 'order.matbaa_approval_pending', aggregateId: order?.id },
  }
  const a = await emit(client, { ...base, recipientIds: pendingLeaders, link: '/siparis-talepleri' })
  const b = await emit(client, { ...base, event: null, recipientIds: pendingDesigners, link: '/siparis-onay' })
  return a + b
}

/* ------------------------------ handovers -------------------------------- */

/** Matbaa raised a teslim → tell sales to confirm receipt. */
export async function notifyHandoverRequested(client, { project, actor }) {
  const sales = await activeUserIdsByRole(client, 'satis')
  return emit(client, {
    recipientIds: sales, actorId: actor?.id, type: 'handover_request', tone: 'amber',
    title: project.title, body: 'Teslim talebi, onayınızı bekliyor',
    projectId: project.id, link: '/teslim-onaylari',
    event: { type: 'handover.requested', aggregateId: project.id },
  })
}

/** Sales confirmed receipt → tell the matbaa who raised it + leaders + designers. */
export async function notifyHandoverConfirmed(client, { project, actor, raisedBy, assignees }) {
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  const designers = (assignees ?? (await loadProjectAssignees(client, project))).map((a) => a.id)
  return emit(client, {
    recipientIds: [raisedBy, ...leaders, ...designers], actorId: actor?.id,
    type: 'handover_confirmed', tone: 'pink',
    title: project.title, body: 'Teslim onaylandı, satışa çıktı 🎉',
    projectId: project.id, link: `/projects/${project.id}`,
    event: { type: 'handover.confirmed', aggregateId: project.id },
  })
}
