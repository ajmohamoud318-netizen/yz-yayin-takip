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

// Keys are order STATUS values (domain/orders.js ORDER_STEPS), and every step
// in ORDER_STEP_OWNER must appear in all three maps below — a missing key
// doesn't throw, it silently falls through to the `??` defaults at the bottom
// of notifyOrderTransition and ships a notification that says nothing.
//
// That is exactly what migration 066's rename did: `pending` →
// `atama_bekleniyor` and `ekran_onay` → `ekran_onayinda` landed in
// domain/orders.js and on the client, but these maps kept the old spelling.
// Both steps are the team leader's, so every new baskı talebi reached her as
// the bare project title + 'Baskı güncellendi' instead of naming the action
// she actually owed — the notification's whole job. The client had the same
// drift and was fixed in project-detail.js's ORDER_ACTION_LABELS; this side
// was missed. The 'every owned order step has copy of its own' test in
// notifications.test.js reads these keys back through orderStepCopyKeys() and
// fails the build if a future rename reopens the gap.
const ORDER_STEP_BODY = {
  atama_bekleniyor: 'Yeni baskı talebi, tasarımcıya atamanızı bekliyor',
  tasarimciya_atandi: 'Baskı kontrolünüzü bekliyor',
  kontroller_tamam: 'Baskı kontrolleri tamam, ozalit formunu gönderin',
  matbaa_ozalit_yapiyor: 'Baskı ozalit isteniyor',
  ekran_onayinda: 'Ekran onayı bekleniyor',
  baski_onayi_bekleniyor: 'Baskı onay formu bekleniyor',
}

// A step reached by a REJECTION owes its owner different copy than the same
// step reached by an advance: the work already exists and has been sent back,
// so "Baskı kontrolünüzü bekliyor" reads as a fresh assignment and hides the
// bounce. Same hazard the pipeline's demo-rejected-to-designer branch was
// fixed for (see notifications.test.js's rejection block). Only the three
// steps ORDER_REJECT_TARGETS can actually land on need an entry; anything
// else falls back to the advance copy above.
const ORDER_STEP_BODY_REJECTED = {
  atama_bekleniyor: 'Baskı geri gönderildi, yeniden tasarımcı atayın',
  tasarimciya_atandi: 'Baskı revizyon için size geri gönderildi',
  matbaa_ozalit_yapiyor: 'Ozalit revizyon istendi, yeniden hazırlayın',
}

const ORDER_STEP_LINK = {
  atama_bekleniyor: '/siparis-talepleri',
  tasarimciya_atandi: '/siparis-onay',
  kontroller_tamam: '/siparis-onay',
  matbaa_ozalit_yapiyor: '/approvals/siparis',
  ekran_onayinda: '/siparis-talepleri',
  baski_onayi_bekleniyor: '/siparis-talepleri',
}
// Every value here MUST be one of notifications.tone's five allowed values
// (migration 022: amber/green/rose/blue/pink). A tone outside that set fails
// the CHECK constraint inside `emit`, which rolls back the WHOLE advance
// transaction — the order silently refuses to move and the client sees a bare
// 500. 'violet' sat here and did exactly that to every advance into
// baski_onayi_bekleniyor (the completing imza_bekleniyor approval and every ekran_onay
// approval). It only ever fired in production because `emit` short-circuits
// when the actor is the sole recipient — a single-team-leader dev DB never
// reaches the INSERT.
//
// baski_onayi_bekleniyor is amber for the same reason its project-pipeline twin
// `baski_onay_pending` is: it's a step that owes someone an action.
//
// The tone fallback ('blue') is a legal tone, which is why the tone test below
// kept passing straight through the migration-066 key drift described above —
// it only ever asserted the CHECK constraint, never that the key was found.
const ORDER_STEP_TONE = {
  atama_bekleniyor: 'amber', tasarimciya_atandi: 'green', kontroller_tamam: 'green',
  matbaa_ozalit_yapiyor: 'blue', ekran_onayinda: 'blue', baski_onayi_bekleniyor: 'amber',
}

/**
 * A sipariş (order) moved to `newStatus`. Notify whoever must act on that
 * step. `onaylandi` is terminal → the sales requester is told it's approved.
 * `assigneeIds` are the designers assigned to THIS order (so the 'tasarimciya_atandi'
 * step pings the right designers, not every designer).
 *
 * `action` mirrors notifyProjectTransition's: 'advance' (the default) or
 * 'reject', which swaps in ORDER_STEP_BODY_REJECTED so the step's owner is
 * told the work came back rather than that it just arrived.
 */
export async function notifyOrderTransition(client, {
  order, project, newStatus, actor, requesterId, assigneeIds = [], action = 'advance',
}) {
  const title = project?.title ?? order?.project_title ?? 'Baskı'
  const base = { actorId: actor?.id, title, projectId: order?.project_id ?? project?.id, orderId: order?.id,
    event: { type: 'order.transition', aggregateId: order?.id } }

  if (newStatus === 'baskida') {
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
  if (newStatus === 'imza_bekleniyor') {
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

  // matbaa_ozalit_yapiyor is the printer's own sign-off step. The queue at
  // /approvals/siparis normally makes them tap a card's "Teslim Edin" button
  // before TalepSignDialog opens; the printer works form-first, so the tap
  // should land straight in the form instead. Carrying the order id lets
  // Approvals.jsx open it on arrival — every other step's link is a plain
  // list page its owner (leader/designer) is expected to triage first.
  const link = newStatus === 'matbaa_ozalit_yapiyor' && order?.id
    ? `/approvals/siparis?order=${order.id}`
    : (ORDER_STEP_LINK[newStatus] ?? '/siparis-talepleri')

  const body = (action === 'reject' ? ORDER_STEP_BODY_REJECTED[newStatus] : null)
    ?? ORDER_STEP_BODY[newStatus]
    ?? 'Baskı güncellendi'

  return emit(client, {
    ...base, recipientIds, type: 'order_step', tone: ORDER_STEP_TONE[newStatus] ?? 'blue',
    body, link,
  })
}

/**
 * Test seam: the copy tables above are module-private so nothing outside can
 * emit an unreviewed body, but the drift guard in notifications.test.js has to
 * see which keys exist. Exported read-only rather than exporting the tables.
 */
export function orderStepCopyKeys() {
  return {
    body: Object.keys(ORDER_STEP_BODY),
    link: Object.keys(ORDER_STEP_LINK),
    tone: Object.keys(ORDER_STEP_TONE),
    rejected: Object.keys(ORDER_STEP_BODY_REJECTED),
  }
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
 * on different pages (see notifyOrderTransition's imza_bekleniyor case above).
 */
/**
 * Full parity with the main pipeline's demo/ozalit started/cancel/edit/
 * change-request notifications (migration 048/049), scoped to the order's
 * own ozalit round (matbaa_ozalit_yapiyor). Only team_leader can cancel/edit/
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

/**
 * One team leader prepared the sipariş Baskı Onay Formu (migration 060) → tell
 * every OTHER active leader that an approval is owed. The preparer is dropped
 * from the list because they cannot sign their own preparation while anyone
 * else is active, so a ping would only send them back to a button that
 * refuses them.
 *
 * The lone-leader case deliberately notifies nobody: the escape hatch in
 * `Order.approveBaskiOnayForm` lets that same leader approve, and they are
 * standing in the dialog that just told them so.
 */
export async function notifyOrderBaskiOnayPrepared(client, { order, project, actor, teamLeaderIds = [] }) {
  const pending = teamLeaderIds.filter((id) => id !== actor?.id)
  return emit(client, {
    recipientIds: pending, actorId: actor?.id,
    title: project?.title ?? order?.project_title ?? 'Baskı',
    projectId: order?.project_id ?? project?.id, orderId: order?.id,
    type: 'order_baski_onay_pending', tone: 'amber',
    body: `${actor?.name ?? 'Ekipten biri'} baskı onay formunu hazırladı, onayınız bekleniyor`,
    link: '/siparis-talepleri',
    event: { type: 'order.baski_onay_prepared', aggregateId: order?.id },
  })
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

/**
 * A sipariş's ozalit parçalar were signed off (migration 080).
 *
 * Named per parça, always. On a three-parça round a bare "onaylandı" reads as
 * though the whole reprint cleared — the same hazard the project pipeline's
 * per-parça branch exists to avoid, and the reason its messages carry the
 * parça name rather than the project's alone.
 *
 * Audience is whoever still owes a signature. A completing click sends no
 * notification from here at all: the order transitions, and
 * notifyOrderTransition announces that instead.
 */
export async function notifyOrderParcaApproved(client, {
  order, project, actor, parcalar = [], stillPending = [],
}) {
  if (stillPending.length === 0) return 0
  const leaders = await activeUserIdsByRole(client, 'team_leader')
  const designers = Array.isArray(order?.assignee_ids) ? order.assignee_ids : []
  return emit(client, {
    actorId: actor?.id,
    recipientIds: [...leaders, ...designers],
    type: 'order_parca_approved',
    title: project?.title ?? order?.project_title ?? 'Baskı',
    body: `${parcalar.join(', ')} onaylandı, bekleyen: ${stillPending.join(', ')}`,
    tone: 'green',
    projectId: order?.project_id ?? project?.id,
    orderId: order?.id,
    link: '/siparis-talepleri',
    event: { type: 'order.parca_approved', aggregateId: order?.id },
  })
}

/**
 * A sipariş's ozalit parça was sent back.
 *
 * One desk, one message: the parça goes to the designer OR the matbaa, and
 * telling both would put work in a queue that isn't theirs. Mirrors the
 * project pipeline's per-parça reject branch, which is keyed on the reject
 * target for exactly this reason.
 *
 * The parçalar NOT named here keep their sign-offs, so the message names the
 * ones that came back rather than implying the round did.
 */
export async function notifyOrderParcaRejected(client, {
  order, project, actor, parcalar = [], reason, target,
}) {
  const toMatbaa = target === 'matbaa'
  const recipientIds = toMatbaa
    ? await activeUserIdsByRole(client, 'printer')
    : (Array.isArray(order?.assignee_ids) ? order.assignee_ids : [])
  const names = parcalar.join(', ')
  return emit(client, {
    actorId: actor?.id,
    recipientIds,
    type: 'order_parca_rejected',
    title: project?.title ?? order?.project_title ?? 'Baskı',
    body: toMatbaa
      ? `${names} yeniden basılacak${reason ? `: ${reason}` : ''}`
      : `${names} reddedildi, revizyon gerekiyor${reason ? `: ${reason}` : ''}`,
    tone: 'rose',
    projectId: order?.project_id ?? project?.id,
    orderId: order?.id,
    // The matbaa works parça cards, the designer works the order page.
    link: toMatbaa ? '/matbaa-isleri' : '/siparis-onay',
    event: { type: 'order.parca_rejected', aggregateId: order?.id },
  })
}

/**
 * A reprint went into production on a title that is ALREADY at or past baskıda
 * — most often one that is `satista`.
 *
 * This exists because the project's stage cannot represent the work. The flip
 * to `baskida` is forward-only, correctly: a sold book really is on sale, and
 * regressing it would be a lie about the title rather than a fact about the
 * reprint. But /baski-listesi filters PROJECTS by stage, so a reprint of a
 * sold title lands on no production queue anywhere, and the stage-flip
 * notification never fires because there was no flip.
 *
 * The result was a sipariş that ran the whole pipeline — assigned, checked,
 * proofed, signed — and then reached the matbaa as silence. Nobody printed it
 * because nobody was told, and nothing in the app showed it as owed.
 *
 * So the printers are told about the ORDER instead of about a stage that did
 * not move. Leaders and designers are not: they just approved the sheet that
 * caused this, and they hear it through the order's own approval path.
 */
export async function notifyOrderReprintIntoProduction(client, { order, project, actor }) {
  const printers = await activeUserIdsByRole(client, 'printer')
  const title = project?.title ?? order?.project_title ?? 'Baskı'
  return emit(client, {
    actorId: actor?.id,
    recipientIds: printers,
    type: 'production_ready',
    title,
    // Named as a REPRINT. "Proje baskıda alındı" would be wrong twice over on a
    // sold title: the project did not move, and the printer's own queue will go
    // on showing it as satışta while this run is outstanding.
    body: 'Yeni baskı talebi onaylandı, üretime alındı',
    tone: 'green',
    projectId: order?.project_id ?? project?.id,
    orderId: order?.id,
    // /baski-listesi — the print queue, and the one page with no RoleGuard on
    // it, so the matbaa can actually open it. It now lists reprints of titles
    // that are past baskıda alongside the projects at it; without that section
    // this link would land them somewhere the job is invisible, which the
    // pipeline's own baskida branch warns is worse than no link at all.
    link: '/baski-listesi',
    event: { type: 'order.reprint_into_production', aggregateId: order?.id },
  })
}
