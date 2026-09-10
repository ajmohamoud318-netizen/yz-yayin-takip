import { nanoid } from 'nanoid'
import { attachUser } from '../middleware/auth.js'
import { badRequest, forbidden, notFound } from '../domain/errors.js'
import { withTx } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { assertHandoverEligible, assertOrderHandoverEligible } from '../domain/pipeline.js'
import {
  getProject, getProjectForUpdate, patchProject, logHistory,
} from '../services/project-repository.js'
import { insertOrderHistory, lockOrder } from '../services/order-repository.js'
import { confirmOrderHandover } from '../services/orders-service.js'
import { schemas } from '../schemas/index.js'
import { notifyHandoverRequested, notifyHandoverConfirmed } from '../services/notifications.js'

/**
 * Teslim (handover) API: matbaa raises, satis confirms.
 *
 * GET   /api/handovers
 * POST  /api/handovers        — { projectId } or { orderId }
 * PATCH /api/handovers/:id/confirm
 *
 * TWO KINDS OF TESLİM (migration 081)
 *
 * `handovers.order_id` decides which:
 *
 *   NULL → the PROJECT's own teslim. The first print run reaching the end of
 *          the pipeline. Confirming it moves the project to `satista`, and it
 *          is still the only path to that stage.
 *   set  → one SİPARİŞ's print run. A reprint of a title that is already at
 *          or past baskıda, whose approval deliberately did NOT move the
 *          project's stage. Confirming it closes the ORDER (`teslim_edildi`)
 *          and leaves the stage alone — the book has been on sale all along.
 *
 * Both the raise AND the confirm are written to `stage_history` so the
 * project timeline shows the full handover story (who shipped, who
 * received, when). A reprint's teslim additionally writes `order_history`,
 * so the order's own timeline can tell it too.
 */
export async function handoverRoutes(fastify) {
  fastify.get('/handovers', async (request) => {
    await attachUser(request)
    const { rows } = await getPool().query(
      // `order_id` and the order's status ride along so the SPA can label a
      // reprint's teslim as one — both kinds carry the same project_id and
      // title, so without them the two are indistinguishable on the card.
      `SELECT h.id, h.project_id, h.order_id, h.status, h.from_stage, h.raised_by, h.confirmed_by,
              h.created_at, h.confirmed_at, p.title AS project_title, p.type AS project_type,
              o.status AS order_status,
              rb.name AS raised_by_name, cb.name AS confirmed_by_name
       FROM handovers h
       JOIN projects p ON p.id = h.project_id AND p.deleted_at IS NULL
       LEFT JOIN order_requests o ON o.id = h.order_id
       LEFT JOIN users rb ON rb.id = h.raised_by
       LEFT JOIN users cb ON cb.id = h.confirmed_by
       ORDER BY h.created_at DESC`,
    )
    return rows
  })

  fastify.post('/handovers', { schema: schemas.handoversCreate }, async (request) => {
    await attachUser(request)
    if (request.user.role !== 'printer') forbidden('Yalnızca matbaa teslim oluşturabilir.')
    const { projectId = null, orderId = null } = request.body
    // The schema enforces exactly one of the two, but state the invariant here
    // too: everything below branches on it, and a future caller reaching this
    // function directly must not be able to create a teslim that is neither.
    if (!projectId === !orderId) {
      badRequest('Teslim talebi bir projeye veya bir siparişe ait olmalıdır.')
    }

    const result = orderId
      ? await raiseOrderHandover(request, orderId)
      : await raiseProjectHandover(request, projectId)
    return result
  })

  fastify.patch('/handovers/:id/confirm', { schema: schemas.handoversConfirm }, async (request) => {
    await attachUser(request)
    if (request.user.role !== 'satis') forbidden('Alındı onayını yalnızca satış verebilir.')
    const result = await withTx(async (client) => {
      const { rows: ho } = await client.query(
        'SELECT * FROM handovers WHERE id = $1 FOR UPDATE', [request.params.id],
      )
      const handover = ho[0]
      if (!handover) notFound('Teslim talebi bulunamadı.')
      if (handover.status !== 'pending') badRequest('Bu teslim zaten sonuçlandırılmış.')
      const { rows } = await client.query(
        `UPDATE handovers
           SET status = 'received', confirmed_by = $2, confirmed_at = NOW()
         WHERE id = $1
         RETURNING id, project_id, order_id, status, from_stage, raised_by, confirmed_by,
                   created_at, confirmed_at`,
        [handover.id, request.user.id],
      )
      return handover.order_id
        ? confirmOrderHandoverReceipt(client, request, handover, rows[0])
        : confirmProjectHandoverReceipt(client, request, handover, rows[0])
    })
    return result
  })
}

/* ---------------------------------------------------------------------------
 * Raising
 * ------------------------------------------------------------------------- */

/** The project's own teslim — the first run reaching the end of the pipeline. */
async function raiseProjectHandover(request, projectId) {
  const project = await getProject(projectId)
  if (!project) notFound('Proje bulunamadı.')
  assertHandoverEligible(project)
  const { rows: pending } = await getPool().query(
    "SELECT id FROM handovers WHERE project_id = $1 AND order_id IS NULL AND status = 'pending'",
    [projectId],
  )
  if (pending.length > 0) badRequest('Bu proje için zaten bekleyen bir teslim talebi var.')

  return withTx(async (client) => {
    const row = await insertHandover(client, {
      projectId, orderId: null, fromStage: project.stage, raisedBy: request.user.id,
    })
    // The matbaa just raised a handover — log it so the project
    // timeline can pair the "talep oluşturuldu" row with the later
    // "alındı" confirmation.
    await logHistory(
      client,
      {
        project_id: projectId,
        from_stage: project.stage,
        to_stage: project.stage,
        action: 'system',
        event: 'handover_request',
        note: 'Teslim talebi oluşturuldu',
      },
      request.user,
    )
    await notifyHandoverRequested(client, { project, actor: request.user })
    return row
  })
}

/**
 * A sipariş's teslim (migration 081).
 *
 * The order is locked for the whole check-then-insert: `assertOrderHandoverEligible`
 * reads its status, and without the lock a concurrent confirm could close the
 * order between the check and the INSERT, leaving a pending teslim against an
 * order that is already `teslim_edildi`. The unique index would not catch that
 * — it only guards two PENDING rows.
 */
async function raiseOrderHandover(request, orderId) {
  return withTx(async (client) => {
    const order = await lockOrder(client, orderId)
    if (!order) notFound('Talep bulunamadı.')
    const project = await getProject(order.project_id)
    if (!project) notFound('Proje bulunamadı.')
    assertOrderHandoverEligible(order)

    const { rows: pending } = await client.query(
      "SELECT id FROM handovers WHERE order_id = $1 AND status = 'pending'",
      [orderId],
    )
    if (pending.length > 0) badRequest('Bu baskı için zaten bekleyen bir teslim talebi var.')

    const row = await insertHandover(client, {
      projectId: order.project_id,
      orderId,
      // The ORDER's status, not the project's stage. A reprint's teslim is
      // raised while the project sits at `satista` — recording that as the
      // from_stage would read, on the timeline, as though the teslim had
      // moved a book that was already sold.
      fromStage: order.status,
      raisedBy: request.user.id,
    })
    // Both timelines: the project's, so the book's page shows the delivery,
    // and the order's, so the reprint can tell its own story end to end.
    await logHistory(
      client,
      {
        project_id: order.project_id,
        from_stage: project.stage,
        to_stage: project.stage,
        action: 'system',
        event: 'order_handover_request',
        note: 'Baskı için teslim talebi oluşturuldu',
      },
      request.user,
    )
    await insertOrderHistory(client, {
      orderId,
      step: 'handover_request',
      signedById: request.user.id,
      note: 'Teslim talebi oluşturuldu, satış onayı bekleniyor',
    })
    await notifyHandoverRequested(client, { project, actor: request.user, order })
    return row
  })
}

/**
 * `handovers.id` is TEXT PRIMARY KEY with no default — mint an
 * `h-<nanoid>` so the INSERT satisfies NOT NULL.
 */
async function insertHandover(client, { projectId, orderId, fromStage, raisedBy }) {
  const { rows } = await client.query(
    `INSERT INTO handovers (id, project_id, order_id, status, from_stage, raised_by)
     VALUES ($1,$2,$3,'pending',$4,$5)
     RETURNING id, project_id, order_id, status, from_stage, raised_by, created_at, confirmed_at`,
    [`h-${nanoid(16)}`, projectId, orderId, fromStage, raisedBy],
  )
  return rows[0]
}

/* ---------------------------------------------------------------------------
 * Confirming
 * ------------------------------------------------------------------------- */

/** Project teslim confirmed → the project goes on sale. Unchanged behaviour. */
async function confirmProjectHandoverReceipt(client, request, handover, updatedHandover) {
  const project = await getProjectForUpdate(client, handover.project_id)
  if (!project) notFound('Proje bulunamadı.')
  // Pass the locked row's version as the SQL-level OCC guard so a
  // concurrent writer that slipped past `getProjectForUpdate`'s row
  // lock (admin scripts, future non-locking paths) can't silently
  // overwrite this stage flip. Same `expectedVersion` contract the
  // `runProjectCommand` orchestrator uses for FSM-driven writes.
  const updated = await patchProject(
    client,
    project.id,
    { stage: 'satista' },
    { expectedVersion: project.version },
  )
  await logHistory(
    client,
    {
      project_id: project.id,
      from_stage: handover.from_stage,
      to_stage: 'satista',
      action: 'system',
      event: 'handover_confirm',
      note: 'Teslim onaylandı, satışta',
    },
    request.user,
  )
  await notifyHandoverConfirmed(client, {
    project: updated, actor: request.user, raisedBy: handover.raised_by,
  })
  return { handover: updatedHandover, project: updated }
}

/**
 * Reprint teslim confirmed → the ORDER closes and the project is left exactly
 * where it was.
 *
 * The stage is untouched on purpose, and it is the whole point of this branch.
 * A reprint's teslim is raised against a book that is already selling; flipping
 * it to `satista` would be a no-op at best and, on a ÇİN title mid-`gumruk`, an
 * outright regression of the main pipeline.
 *
 * The order row itself is closed by `confirmOrderHandover`, which runs inside
 * this transaction so the receipt and the closure commit together — and which
 * writes both timelines through the same orchestrator every other order
 * command uses, rather than reaching into the tables from here.
 */
async function confirmOrderHandoverReceipt(client, request, handover, updatedHandover) {
  const order = await confirmOrderHandover(handover.order_id, request.user, client)
  const project = await getProjectForUpdate(client, handover.project_id)
  await notifyHandoverConfirmed(client, {
    project: project ?? { id: handover.project_id, title: 'Baskı' },
    actor: request.user,
    raisedBy: handover.raised_by,
    order,
  })
  // `project` is returned unchanged so the SPA's response shape stays the same
  // for both kinds; `order` is what actually moved.
  return { handover: updatedHandover, project, order }
}
