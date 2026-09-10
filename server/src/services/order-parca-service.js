/**
 * Per-parça routing verbs for a SİPARİŞ's ozalit round (migration 080).
 *
 * The sipariş twin of `parca-service.js`, and deliberately its mirror image:
 * every rule, message and edge case here is the one that file already
 * settled, because a reprint runs the same round. The matbaa starts and
 * delivers one parça at a time, the leader takes delivery of each, a rejected
 * parça goes back to its designer alone, and the ORDER only moves when the
 * last parça is off the matbaa's desk.
 *
 * WHAT IS SHARED AND WHAT IS NOT
 *
 * The decisions are shared: every patch comes from `domain/parca-routing.js`,
 * unchanged. Those functions were already pure — they take a row, a clock and
 * a route, and know nothing about projects — so the sipariş gets the identical
 * state machine rather than a lookalike. `canActOnParca`, `parcaAwaitsReceipt`
 * and `parcaAlreadyDelivered` likewise.
 *
 * What differs is only WHERE the round lives:
 *
 *     project                         sipariş
 *     ─────────────────────────────   ────────────────────────────────
 *     stage 'ozalit_teslim'           status 'matbaa_ozalit_yapiyor'
 *     stage 'ozalit_onay'             status 'imza_bekleniyor'
 *     projects.ozalit_received        order_requests.matbaa_received
 *     projects.ozalit_parca_*         order_requests.ozalit_parca_*
 *     loadLatestDemoSnapshot          loadLatestOrderOzalitSnapshot
 *     advanceProject                  advanceOrder
 *
 * WHY NOT `runOrderCommand`
 *
 * Same reason `parca-service.js` stays outside `runProjectCommand`: that
 * orchestrator exists to diff and patch the order row, and none of these verbs
 * change an order column. Routing a single parça through it would mean an
 * `order_requests` UPDATE — and a version bump, and an order_history row —
 * every time a printer taps "İşlemi Başlatın" on one of three parçalar.
 *
 * The two exceptions are explicit and both live in `settleOrderParcaAtGate`:
 * the receipt flag and the rejection ledger are the GATE's own inputs, not
 * routing state, and nothing else will reset them on a leg that never moves
 * the order's status.
 */

import { withTx, getPool } from '../db/pool.js'
import { badRequest, notFound } from '../domain/errors.js'
import {
  parcaRequestRoundPatch,
  parcaStartPatch,
  parcaDeliverPatch,
  parcaReceivePatch,
  parcaAwaitsReceipt,
  parcaAlreadyDelivered,
  parcaChangeRequestable,
  parcaChangeRequestPatch,
  parcaChangeAcceptPatch,
  parcaChangeDeclinePatch,
  canActOnParca,
} from '../domain/parca-routing.js'
import {
  listParcaStateForOrder,
  listOrderParcaStateByOwner,
  upsertOrderParcaState,
  deleteOrderParcaState,
  ensureOrderParcaRows,
} from './parca-state-repository.js'
import { loadLatestOrderOzalitSnapshot } from './project-repository.js'
import * as repo from './order-repository.js'
import { advanceOrder } from './orders-service.js'
import { emit, activeUserIdsByRole } from './notifications.js'

/**
 * Order statuses during which a parça of this order can be acted on at all.
 *
 * `matbaa_ozalit_yapiyor` is the live round — the matbaa holds the sheet.
 * `imza_bekleniyor` is the gate: parçalar are back and awaiting the leader,
 * and a rejected one can be sent round again from here.
 * `ekran_onayinda` is the whole-round screen route; a parça rejected out of it
 * comes back to the designer the same way.
 */
const ORDER_ROUND_STATUSES = new Set([
  'matbaa_ozalit_yapiyor', 'imza_bekleniyor', 'ekran_onayinda',
])

/** Only here does a parça belong to the matbaa by default. */
const ORDER_MATBAA_STATUS = 'matbaa_ozalit_yapiyor'

/**
 * Run inside the caller's transaction when given one, otherwise open our own.
 *
 * The same seam `runOrderCommand` exposes, and for the same reason its comment
 * gives: the routes never pass a client (each request is its own transaction),
 * while the tests pass one to drive these verbs through a real database. It is
 * also what lets a caller compose two of these atomically if it ever needs to.
 */
function inTx(client, body) {
  return client ? body(client) : withTx(body)
}

/** GET /api/order-requests/:id/parca-state */
export async function listOrderParcaState(orderId) {
  return listParcaStateForOrder(null, orderId)
}

/** The order row plus the title it reprints — notifications need both. */
async function loadOrder(client, orderId) {
  const order = await repo.lockOrder(client, orderId)
  if (!order) notFound('Talep bulunamadı.')
  const { rows } = await client.query(
    'SELECT title FROM projects WHERE id = $1', [order.project_id],
  )
  return { ...order, project_title: rows[0]?.title ?? 'Baskı' }
}

/**
 * Lock one parça of one order, materialising its row on first touch.
 *
 * The direct twin of `loadParcaForUpdate`. Rows are NOT seeded when a round is
 * sent — they are written the moment somebody first acts on a parça — so a
 * matbaa can work a fresh sipariş round parça-by-parça with nothing set up in
 * advance. The parça list comes from the round's own sheet
 * (`_selectedComponents`), which is what the designer ticked when they
 * submitted the Ozalit Üretim Formu.
 *
 * Unlike the project side there is no gate ambiguity to resolve: an order has
 * exactly one gate ('ozalit'), so a row found here always belongs to this
 * round. The project version has to check, because one project row carries
 * whichever gate it last cycled on and a finished demo leg would otherwise be
 * read as the live ozalit round.
 */
async function loadOrderParcaForUpdate(client, orderId, parca) {
  const order = await loadOrder(client, orderId)
  const { rows } = await client.query(
    'SELECT * FROM parca_state WHERE order_id = $1 AND parca = $2 FOR UPDATE',
    [orderId, parca],
  )
  const existing = rows[0] ?? null
  if (existing) return { order, row: existing }

  if (!ORDER_ROUND_STATUSES.has(order.status)) {
    notFound('Parça bulunamadı.')
  }
  // No row yet. On a live matbaa round that is normal rather than an error —
  // materialise it from the sheet the round went out with.
  const snapshot = await loadLatestOrderOzalitSnapshot(client, orderId)
  if (!(snapshot?.selectedComponents ?? []).includes(parca)) {
    notFound('Parça bu turda yok.')
  }
  if (order.status !== ORDER_MATBAA_STATUS) {
    // At the gate with no row: the parça exists on the sheet but nobody has
    // routed it anywhere. It is the leader's to approve, on nobody's desk.
    const created = await upsertOrderParcaState(client, order.project_id, orderId, parca, {
      gate: 'ozalit', state: 'pending', attempt: 1,
    })
    return { order, row: created }
  }
  const created = await upsertOrderParcaState(client, order.project_id, orderId, parca, {
    gate: 'ozalit',
    state: 'with_matbaa',
    owner_role: 'printer',
    route: 'physical',
    // 1, not the snapshot's attempt: this is the parça's FIRST time round by
    // definition — we are here precisely because it has no row — and only a
    // reject raises the count from here.
    attempt: 1,
  })
  return { order, row: created }
}

/**
 * Is every parça of this round off the matbaa's desk?
 *
 * Only then does the ORDER move. A partial delivery leaves it at
 * `matbaa_ozalit_yapiyor`, which is the whole point: the parçalar the matbaa
 * hasn't done stay theirs until they do.
 *
 * A single-parça round short-circuits to true, keeping the old whole-sheet
 * behaviour for every order that has no per-parça life — the same rule
 * `allParcalarDelivered` applies on the project side, and what keeps this
 * feature from changing how an ordinary one-parça reprint behaves.
 */
export async function allOrderParcalarDelivered(client, orderId) {
  const snapshot = await loadLatestOrderOzalitSnapshot(client, orderId)
  const parcalar = snapshot?.selectedComponents ?? []
  if (parcalar.length < 2) return true
  const { rows } = await client.query(
    'SELECT parca, state FROM parca_state WHERE order_id = $1', [orderId],
  )
  const byParca = new Map(rows.map((r) => [r.parca, r.state]))
  return parcalar.every((p) => {
    const state = byParca.get(p)
    // Never touched, or still on their desk → the round is not finished.
    return state != null && state !== 'with_matbaa' && state !== 'in_round'
  })
}

/**
 * A parça landed back at the gate — bring the ORDER columns the gate reads
 * back in step with it.
 *
 * The sipariş twin of `settleParcaAtGate`, and it exists for the same two live
 * bugs that one documents:
 *
 *   `matbaa_received` — the receipt gate. `computeMatbaaOnayApproval` refuses
 *   until it is true, and the whole-round legs clear it on every fresh
 *   delivery. Without this, the flag stays true from the first acknowledgment
 *   and every parça the matbaa reprints could be approved without anyone
 *   confirming it arrived. Only a PHYSICAL delivery clears it — an ekran round
 *   has nothing to receive.
 *
 *   `ozalit_parca_rejections` — append-only, and read to decide whether a parça
 *   still shows "Reddedildi". Leaving the row behind means a parça that was
 *   rejected, reworked and handed back reads as rejected for the life of the
 *   order.
 */
async function settleOrderParcaAtGate(client, order, parca, { received }) {
  const rejections = (order.ozalit_parca_rejections ?? []).filter((r) => r?.parca !== parca)
  const fields = { ozalit_parca_rejections: rejections }
  if (received) {
    Object.assign(fields, {
      matbaa_received: false, matbaa_received_by: null, matbaa_received_at: null,
    })
  }
  return repo.updateOrder(client, order.id, fields)
}

/**
 * Seed a sipariş round's parça rows from the sheet it went out with.
 *
 * Called when the designer submits the Ozalit Üretim Formu. Seeding by UNION
 * (`ensureOrderParcaRows`) rather than replacing: a re-round that carries only
 * the rejected parça must not drop the approvals of the parçalar it leaves
 * alone. That is the trap migration 074's header spells out, and it applies
 * here identically.
 */
export async function seedOrderParcaRows(client, order) {
  const snapshot = await loadLatestOrderOzalitSnapshot(client, order.id)
  const parcalar = snapshot?.selectedComponents ?? []
  if (parcalar.length < 2) return []
  return ensureOrderParcaRows(client, order.project_id, order.id, parcalar)
}

/* ---------------------------------------------------------------------------
 * The matbaa's two beats
 * ------------------------------------------------------------------------- */

/** POST /api/order-requests/:id/parca/:parca/start — the matbaa began this parça. */
export async function startOrderParca(orderId, parca, actor, client = null) {
  return inTx(client, async (client) => {
    const { row } = await loadOrderParcaForUpdate(client, orderId, parca)
    if (actor?.role !== 'printer') {
      badRequest('Parça çalışmasını yalnızca matbaa başlatabilir.')
    }
    if (!canActOnParca(actor, row)) {
      badRequest('Bu parça sizde değil.')
    }
    // Accepting a change request un-started this parça so the leader could
    // correct the sheet; re-starting before the correction lands would put the
    // matbaa back to work on the version they just agreed was wrong.
    if (row.fix_pending) {
      badRequest('Kabul edilen değişiklik talebi için düzeltme bekleniyor, önce form güncellenmelidir.')
    }
    if (row.started_at) return row // idempotent — already started
    return upsertOrderParcaState(
      client, row.project_id, orderId, parca,
      parcaStartPatch({ now: new Date().toISOString() }),
    )
  })
}

/**
 * POST /api/order-requests/:id/parca/:parca/deliver — the matbaa handed this
 * parça back. It returns to the gate with no owner: from here it is the
 * leader's call again.
 */
export async function deliverOrderParca(orderId, parca, actor, client = null) {
  return inTx(client, async (client) => {
    const { order, row } = await loadOrderParcaForUpdate(client, orderId, parca)
    if (actor?.role !== 'printer') {
      badRequest('Parça teslimini yalnızca matbaa yapabilir.')
    }
    // Idempotent for the sharp reason the project twin documents: delivering
    // CLEARS owner_role, so a second tap of the same button failed
    // canActOnParca and came back as "Bu parça sizde değil." on a parça the
    // printer had just delivered successfully.
    if (parcaAlreadyDelivered(row)) return row
    if (!canActOnParca(actor, row)) {
      if (row.state === 'approved') badRequest('Bu parça onaylandı, teslim edilecek bir şey yok.')
      if (row.state === 'with_designer') badRequest('Bu parça tasarımcıda, sizde değil.')
      badRequest('Bu parça sizde değil.')
    }
    if (!row.started_at) {
      badRequest('Önce "İşlemi Başlatın" ile çalışmayı işaretleyin.')
    }
    const updated = await upsertOrderParcaState(
      client, order.project_id, orderId, parca,
      parcaDeliverPatch({ now: new Date().toISOString() }),
    )

    // Something physical arrived: the leader owes a fresh "Teslim Alındı"
    // before they can sign it off, and this parça is no longer a rejected one.
    await settleOrderParcaAtGate(client, order, parca, { received: true })

    // The ORDER only follows once the LAST parça is off their desk — and only on
    // the round the matbaa is producing. A parça rejected back to the matbaa at
    // imza_bekleniyor returns to a gate the order is already standing at;
    // "advancing" from there ran the leaders' approval as the printer, which
    // refused and rolled the delivery back. The project twin draws the same line
    // (TESLIM_GATES in deliverParca).
    const atGate = order.status !== ORDER_MATBAA_STATUS
    if (!atGate && await allOrderParcalarDelivered(client, orderId)) {
      // The same transition the whole-sheet "Teslim Edin" performs, run inside
      // this transaction so the last parça's delivery and the status move
      // commit together. It carries its own history row and notifications.
      await advanceOrder(orderId, actor, { parcaRoundComplete: true }, client)
      return updated
    }

    const leaders = await activeUserIdsByRole(client, 'team_leader')
    const designers = Array.isArray(order.assignee_ids) ? order.assignee_ids : []
    await emit(client, {
      recipientIds: [...leaders, ...designers],
      actorId: actor?.id,
      type: 'parca_delivered',
      tone: 'amber',
      title: order.project_title,
      projectId: order.project_id,
      orderId,
      body: atGate
        ? `${parca} yeniden teslim edildi, teslim alınması bekleniyor`
        : `${parca} teslim edildi, diğer parçalar bekleniyor`,
      link: '/siparis-talepleri',
      event: { type: 'order.parca_delivered', aggregateId: orderId },
    })
    return updated
  })
}

/* ---------------------------------------------------------------------------
 * The leader's receipt
 * ------------------------------------------------------------------------- */

/**
 * POST /api/order-requests/:id/parca/:parca/receive — per-parça "Teslim Alındı".
 *
 * Who may: the same two parties the order-level receipt allows — a team leader,
 * or a designer assigned to THIS ORDER. It is a statement about physical
 * possession, so it belongs to whoever is holding the thing.
 *
 * Idempotent, and notifies nobody: the receipt is the receiver's own act and
 * the parça does not change hands.
 */
export async function receiveOrderParca(orderId, parca, actor, client = null) {
  return inTx(client, async (client) => {
    const { order, row } = await loadOrderParcaForUpdate(client, orderId, parca)
    if (row.received_at) return row // idempotent — already acknowledged

    const isAssignedDesigner = actor?.role === 'designer'
      && (order.assignee_ids ?? []).includes(actor?.id)
    if (actor?.role !== 'team_leader' && !isAssignedDesigner) {
      badRequest('Teslim almayı yalnızca ekip lideri veya atanmış tasarımcı yapabilir.')
    }
    if (!parcaAwaitsReceipt(row)) {
      // Three ways to get here, and the message has to tell them apart.
      if (row.state !== 'pending') badRequest('Bu parça şu anda onay bekleyen bir parça değil.')
      if (row.route === 'ekran') badRequest('Ekran turunda teslim alma yapılmaz.')
      badRequest('Bu parça henüz teslim edilmedi.')
    }

    return upsertOrderParcaState(client, order.project_id, orderId, parca, parcaReceivePatch({
      actor,
      actorName: actor?.name ?? 'Bilinmeyen',
      now: new Date().toISOString(),
      // Carried back in: the upsert writes the delivery stamps verbatim, so
      // omitting this would erase the delivery we are acknowledging.
      deliveredAt: row.delivered_at,
    }))
  })
}

/* ---------------------------------------------------------------------------
 * The designer's re-round
 * ------------------------------------------------------------------------- */

/**
 * POST /api/order-requests/:id/parca/:parca/request-round — the designer
 * revized this parça and is sending it back round.
 *
 * `route` mirrors the project-level post-revize picker: 'physical' goes to the
 * matbaa, 'ekran' goes straight back to the leader with no print at all.
 *
 * The ekran leg is the one with teeth. A parça sent to screen is approved by
 * the LEADER ALONE — the designer's request is their sign-off, and asking them
 * to counter-sign their own screen check would be theatre. That rule lives in
 * the approval gate (the ledger row is marked `via: 'ekran'`); what happens
 * here is the other half of it: the parça returns to the gate immediately,
 * with its rejection cleared, because there is nothing to print and nothing to
 * receive.
 */
export async function requestOrderParcaRound(orderId, parca, actor, { route } = {}, client = null) {
  return inTx(client, async (client) => {
    const { order, row } = await loadOrderParcaForUpdate(client, orderId, parca)
    const isAssignedDesigner = actor?.role === 'designer'
      && (order.assignee_ids ?? []).includes(actor?.id)
    // A leader may send a parça back round on the designer's behalf — the same
    // latitude the project-level round gives them.
    if (!isAssignedDesigner && actor?.role !== 'team_leader') {
      badRequest('Bu parçayı yalnızca atanmış tasarımcı veya ekip lideri gönderebilir.')
    }
    if (row.state !== 'with_designer') {
      badRequest('Bu parça revizede değil.')
    }
    const updated = await upsertOrderParcaState(
      client, order.project_id, orderId, parca,
      parcaRequestRoundPatch({ route, now: new Date().toISOString() }),
    )

    // An ekran round skips the matbaa entirely, so the parça is back at the
    // gate the moment the designer sends it — clear its rejection row now. A
    // physical round keeps it: the parça is still out, just with the matbaa
    // instead of the designer, and `deliverOrderParca` clears it on arrival.
    // Neither touches the receipt flag; nothing has been printed.
    if (route === 'ekran') {
      await settleOrderParcaAtGate(client, order, parca, { received: false })
      const leaders = await activeUserIdsByRole(client, 'team_leader')
      await emit(client, {
        recipientIds: leaders,
        actorId: actor?.id,
        type: 'parca_ekran_pending',
        tone: 'amber',
        title: order.project_title,
        projectId: order.project_id,
        orderId,
        body: `${parca} ekran onayı bekleniyor`,
        link: '/siparis-talepleri',
        event: { type: 'order.parca_ekran_pending', aggregateId: orderId },
      })
    } else {
      const printers = await activeUserIdsByRole(client, 'printer')
      await emit(client, {
        recipientIds: printers,
        actorId: actor?.id,
        type: 'parca_round_requested',
        tone: 'blue',
        title: order.project_title,
        projectId: order.project_id,
        orderId,
        body: `${parca} için yeni tur bekleniyor`,
        // /matbaa-isleri, NOT /approvals/siparis?order=. That deep link
        // auto-opens TalepSignDialog — the WHOLE-ORDER sheet, whose "Teslim
        // Edin" advances the order past parçalar nobody produced. It is also
        // the card this order no longer has, because a split round is shown as
        // parça cards instead. The printer's hub renders those.
        link: '/matbaa-isleri',
        event: { type: 'order.parca_round_requested', aggregateId: orderId },
      })
    }
    return updated
  })
}

/* ---------------------------------------------------------------------------
 * The change-request handshake, per parça
 *
 * The order-level trio reads `order_requests.ozalit_started`, which a split
 * round never sets — `startOrderParca` leaves it alone on purpose, exactly as
 * `startParca` leaves `projects.ozalit_started` alone. These are the same three
 * verbs reading the parça's own `started_at` instead.
 * ------------------------------------------------------------------------- */

/** The leader asks the matbaa to release a parça they have already started. */
export async function requestOrderParcaChange(orderId, parca, actor, { note } = {}, client = null) {
  return inTx(client, async (client) => {
    const { order, row } = await loadOrderParcaForUpdate(client, orderId, parca)
    if (actor?.role !== 'team_leader') {
      badRequest('Değişiklik talebini yalnızca ekip lideri yapabilir.')
    }
    if (!parcaChangeRequestable(row)) {
      badRequest('Bu parça için değişiklik talebi yapılamaz.')
    }
    const updated = await upsertOrderParcaState(
      client, order.project_id, orderId, parca,
      parcaChangeRequestPatch({
        note,
        actor,
        actorName: actor?.name ?? 'Bilinmeyen',
        now: new Date().toISOString(),
        startedAt: row.started_at,
      }),
    )
    const printers = await activeUserIdsByRole(client, 'printer')
    await emit(client, {
      recipientIds: printers,
      actorId: actor?.id,
      type: 'parca_change_requested',
      tone: 'amber',
      title: order.project_title,
      projectId: order.project_id,
      orderId,
      body: note
        ? `${parca} için değişiklik istendi, not: ${note}`
        : `${parca} için değişiklik istendi, kabul veya red bekleniyor`,
      // Same reasoning as parca_round_requested above: the answer to this
      // question is a button on the parça card, not in the whole-order sheet.
      link: '/matbaa-isleri',
      event: { type: 'order.parca_change_requested', aggregateId: orderId },
    })
    return updated
  })
}

/** The matbaa accepts — the parça un-starts so the leader's correction can land. */
export async function acceptOrderParcaChange(orderId, parca, actor, client = null) {
  return inTx(client, async (client) => {
    const { order, row } = await loadOrderParcaForUpdate(client, orderId, parca)
    if (actor?.role !== 'printer') {
      badRequest('Değişiklik talebini yalnızca matbaa yanıtlayabilir.')
    }
    if (!row.change_requested_at) {
      badRequest('Bu parça için bekleyen bir değişiklik talebi yok.')
    }
    const updated = await upsertOrderParcaState(
      client, order.project_id, orderId, parca, parcaChangeAcceptPatch(),
    )
    const leaders = await activeUserIdsByRole(client, 'team_leader')
    await emit(client, {
      recipientIds: leaders,
      actorId: actor?.id,
      type: 'parca_change_accepted',
      tone: 'green',
      title: order.project_title,
      projectId: order.project_id,
      orderId,
      body: `${parca} için değişiklik kabul edildi, düzeltmeyi gönderin`,
      link: '/siparis-talepleri',
      event: { type: 'order.parca_change_accepted', aggregateId: orderId },
    })
    return updated
  })
}

/** The matbaa declines — the round stays started, nothing else changes. */
export async function declineOrderParcaChange(orderId, parca, actor, client = null) {
  return inTx(client, async (client) => {
    const { order, row } = await loadOrderParcaForUpdate(client, orderId, parca)
    if (actor?.role !== 'printer') {
      badRequest('Değişiklik talebini yalnızca matbaa yanıtlayabilir.')
    }
    if (!row.change_requested_at) {
      badRequest('Bu parça için bekleyen bir değişiklik talebi yok.')
    }
    const updated = await upsertOrderParcaState(
      client, order.project_id, orderId, parca,
      // startedAt is carried back in: declining leaves the parça exactly where
      // it was, and the upsert writes started_at verbatim.
      parcaChangeDeclinePatch({ startedAt: row.started_at }),
    )
    const leaders = await activeUserIdsByRole(client, 'team_leader')
    await emit(client, {
      recipientIds: leaders,
      actorId: actor?.id,
      type: 'parca_change_declined',
      tone: 'rose',
      title: order.project_title,
      projectId: order.project_id,
      orderId,
      body: `${parca} için değişiklik reddedildi, tur devam ediyor`,
      link: '/siparis-talepleri',
      event: { type: 'order.parca_change_declined', aggregateId: orderId },
    })
    return updated
  })
}

/** Retire one parça of an order's round — used when a round no longer carries it. */
export async function dropOrderParca(orderId, parca, client = null) {
  return inTx(client, async (client) => deleteOrderParcaState(client, orderId, parca))
}

/* ---------------------------------------------------------------------------
 * The matbaa's queue
 * ------------------------------------------------------------------------- */

/**
 * Every live sipariş ozalit round the matbaa is holding, keyed by order id.
 *
 * "Live" is simpler than the project side's: an order at
 * `matbaa_ozalit_yapiyor` is by definition a round sitting with the printer.
 * There is no `ozalit_requested` flag to consult and no reject_target subtlety
 * — the status IS the answer, because a sipariş has exactly one gate.
 */
async function loadLiveOrderRounds(db = null) {
  const pool = db ?? getPool()
  const { rows: orders } = await pool.query(
    `SELECT o.id, o.project_id, o.order_no, o.status, o.assignee_ids,
            p.title AS project_title, p.stage AS project_stage, p.type AS project_type
       FROM order_requests o
       JOIN projects p ON p.id = o.project_id
      WHERE o.status = $1 AND p.deleted_at IS NULL`,
    [ORDER_MATBAA_STATUS],
  )
  const out = new Map()
  for (const o of orders) {
    const snapshot = await loadLatestOrderOzalitSnapshot(pool, o.id)
    out.set(o.id, { order: o, parcalar: snapshot?.selectedComponents ?? [] })
  }
  return out
}

/**
 * The parçalar of a live sipariş round that have no row yet.
 *
 * Rows are written on first action, so a round nobody has touched has none at
 * all — and without this the matbaa's queue would be empty for exactly the
 * rounds they have not started. The twin of `deriveTeslimParcalar`, including
 * its two rules:
 *
 *   • a single-parça round keeps the whole-order card it has always had.
 *     Splitting a one-parça sheet into a "parça queue" of one is noise, and it
 *     is what keeps this feature from changing how an ordinary reprint looks.
 *
 *   • `attempt` comes from the ROW, never from the sheet. `demos.attempt` is a
 *     storage slot, deliberately offset; `parca_state.attempt` is this parça's
 *     round number counted from 1. Seeding one from the other makes a
 *     never-reworked parça render "2. tur" on its first round.
 */
async function deriveOrderParcalar(routed, rounds, db = null) {
  const pool = db ?? getPool()
  const seen = new Set(routed.map((r) => `${r.order_id}|${r.parca}`))
  const out = []
  for (const { order: o, parcalar } of rounds.values()) {
    if (parcalar.length < 2) continue
    const { rows: existing } = await pool.query(
      'SELECT parca, state, started_at, attempt FROM parca_state WHERE order_id = $1',
      [o.id],
    )
    const byParca = new Map(existing.map((r) => [r.parca, r]))
    for (const parca of parcalar) {
      if (seen.has(`${o.id}|${parca}`)) continue
      const row = byParca.get(parca)
      // Already handed back (delivered → 'pending') or signed off: not theirs.
      if (row && row.state !== 'with_matbaa' && row.state !== 'in_round') continue
      out.push({
        project_id: o.project_id,
        order_id: o.id,
        parca,
        gate: 'ozalit',
        state: row?.started_at ? 'in_round' : 'with_matbaa',
        owner_role: 'printer',
        route: 'physical',
        attempt: row?.attempt ?? 1,
        started_at: row?.started_at ?? null,
        delivered_at: null,
        received_at: null,
        received_by: null,
        received_by_name: null,
        reason: null,
        rejected_by: null,
        rejected_by_name: null,
        rejected_at: null,
        // A derived row has no handshake on it by definition — asking about a
        // parça materialises a real row. Stated rather than left undefined so
        // every row the queue hands the client has one shape.
        change_requested_at: null,
        change_requested_by: null,
        change_requested_by_name: null,
        change_requested_note: null,
        fix_pending: false,
        project_title: o.project_title,
        project_stage: o.project_stage,
        project_type: o.project_type,
        order_status: o.status,
        order_assignee_ids: o.assignee_ids ?? [],
        order_no: o.order_no,
      })
    }
  }
  return out
}

/**
 * The sipariş half of `listMyParcaQueue`. Concatenated onto the project half
 * by that function, so one queue serves both pipelines and `ParcaJobBoard`
 * renders them side by side.
 */
export async function listMyOrderParcaQueue(actor, db = null) {
  if (actor?.role === 'printer') {
    const routed = await listOrderParcaStateByOwner(db, 'printer', ['with_matbaa', 'in_round'])
    const rounds = await loadLiveOrderRounds(db)
    // Drop rows whose order has since left the matbaa's hands — the order
    // advanced, was rejected, or the parça left the round. The twin of
    // `dropOrphanedRouted`: a stale row would otherwise offer the printer a
    // card whose action the service refuses.
    //
    // …except a parça the leader rejected back to the matbaa at the gate. The
    // order stays at imza_bekleniyor while it is reprinted, so it is never on
    // `rounds`, and filtering on that alone hid real work: the printer was
    // notified, opened Matbaa İşleri and found nothing. `dropOrphanedRouted`
    // keeps the project's equivalent rows for the same reason.
    const live = routed.filter((r) => rounds.has(r.order_id) || r.order_status === 'imza_bekleniyor')
    const fresh = await deriveOrderParcalar(live, rounds, db)
    return [...live, ...fresh]
  }
  if (actor?.role === 'designer') {
    const rows = await listOrderParcaStateByOwner(db, 'designer', ['with_designer'])
    // Scoped to the designer's OWN orders. An order carries `assignee_ids`, so
    // the question is answerable here without a second query — unlike the
    // project side, which hands every designer-owned parça to every designer
    // because the assignment lives in a separate table.
    return rows.filter((r) => (r.order_assignee_ids ?? []).includes(actor?.id))
  }
  return []
}
