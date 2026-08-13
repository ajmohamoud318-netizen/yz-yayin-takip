import { nanoid } from 'nanoid'
import { attachUser } from '../middleware/auth.js'
import { badRequest, forbidden, notFound } from '../domain/errors.js'
import { withTx } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { ORDER_STEP_NEXT, ORDER_STEP_OWNER } from '../domain/orders.js'
import {
  getProject, getProjectForUpdate, patchProject, logHistory,
} from '../services/project-repository.js'
import { assertCanEnterProduction, assertOrderable } from '../domain/pipeline.js'
import { schemas } from '../schemas/index.js'
import { notifyOrderTransition, notifyOrderRejected } from '../services/notifications.js'

/**
 * Sipariş talep workflow.
 *
 * GET    /api/order-requests
 * POST   /api/order-requests              — satis only
 * PATCH  /api/order-requests/:id/advance  — owner of current step
 * PATCH  /api/order-requests/:id/reject   — team_leader only
 *
 * Every state change writes a `stage_history` row tagged with the
 * matching event (`order_request` / `order_transfer` / `order_advance` /
 * `order_final` / `order_reject`) so the project timeline shows the
 * full sales-order story.
 */
export async function orderRoutes(fastify) {
  fastify.get('/order-requests', async (request) => {
    await attachUser(request)
    const { rows } = await getPool().query(
      `SELECT o.id, o.project_id, o.status, o.requested_by, o.payload, o.assignee_ids,
              o.version, o.created_at, o.updated_at, p.title AS project_title,
              u.name AS requested_by_name
       FROM order_requests o
       JOIN projects p ON p.id = o.project_id AND p.deleted_at IS NULL
       LEFT JOIN users u ON u.id = o.requested_by
       ORDER BY o.created_at DESC`,
    )
    // Hydrate history for each order (small list, N+1 is fine for now).
    const out = []
    for (const row of rows) {
      const { rows: hist } = await getPool().query(
        `SELECT oh.step, oh.notes, oh.signed_by_id, oh.created_at,
                u.name AS signed_by_name
           FROM order_history oh
           LEFT JOIN users u ON u.id = oh.signed_by_id
          WHERE oh.order_id = $1 ORDER BY oh.created_at`,
        [row.id],
      )
      const { payload, ...rest } = row
      out.push({
        ...rest,
        // The client (RequestRow, TalepHistoryViewer) reads items/quantity/notes
        // as top-level fields — flatten them out of the JSONB payload column here
        // rather than making every consumer reach into `.payload`.
        items: payload?.items ?? [],
        quantity: payload?.quantity ?? null,
        notes: payload?.notes ?? '',
        order_history: hist.map((h) => ({
          step: h.step,
          notes: h.notes,
          signed_by_id: h.signed_by_id,
          signed_by_name: h.signed_by_name,
          signed_by_role: null,
          signed_at: h.created_at,
          created_at: h.created_at,
        })),
        version: row.version,
      })
    }
    return out
  })

  fastify.post('/order-requests', { schema: schemas.ordersCreate }, async (request) => {
    await attachUser(request)
    if (request.user.role !== 'satis') forbidden('Yalnızca satış sipariş oluşturabilir.')
    const { projectId, payload = {}, items = [], quantity, notes } = request.body
    const project = await getProject(projectId)
    if (!project) notFound('Proje bulunamadı.')
    assertOrderable(project)

    const merged = { ...payload, items, quantity, notes: notes ?? payload.notes ?? '' }

    // order_requests.id is TEXT PRIMARY KEY with no default — mint an
    // `o-<nanoid>` so the INSERT doesn't violate NOT NULL.
    const orderIdRow = `o-${nanoid(16)}`
    const result = await withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO order_requests (id, project_id, status, requested_by, payload)
         VALUES ($1,$2,'pending',$3,$4)
         RETURNING id, project_id, status, requested_by, payload, version, created_at, updated_at`,
        [orderIdRow, projectId, request.user.id, merged],
      )
      const order = rows[0]
      await client.query(
        `INSERT INTO order_history (order_id, step, signed_by_id, notes, created_at)
         VALUES ($1,'pending',$2,$3,NOW())`,
        [order.id, request.user.id, notes ?? ''],
      )
      // Surface the order request in the project timeline. The "from_stage"
      // is the project's current stage at request time (always `satista`
      // right now, but the order stage set could expand later).
      await logHistory(
        client,
        {
          project_id: projectId,
          from_stage: project.stage,
          to_stage: project.stage,
          action: 'system',
          event: 'order_request',
          note: 'Sipariş talebi oluşturuldu',
        },
        request.user,
      )
      // New talep at 'pending' → the team leader must act on it.
      await notifyOrderTransition(client, {
        order, project, newStatus: 'pending', actor: request.user,
        requesterId: order.requested_by,
      })
      return order
    })
    return result
  })

  fastify.patch('/order-requests/:id/advance', { schema: schemas.ordersAdvance }, async (request) => {
    await attachUser(request)
    const orderId = request.params.id
    const { notes = '', assignees = null, expectedVersion = null } = request.body
    const result = await withTx(async (client) => {
      const { rows: orderRows } = await client.query(
        'SELECT * FROM order_requests WHERE id = $1 FOR UPDATE', [orderId],
      )
      const order = orderRows[0]
      if (!order) notFound('Talep bulunamadı.')
      if (expectedVersion != null && order.version !== expectedVersion) {
        const err = new Error('Bu talep başka biri tarafından güncellendi. Sayfayı yenileyin.')
        err.status = 409
        throw err
      }
      const next = ORDER_STEP_NEXT[order.status]
      if (!next) badRequest('Bu talep zaten tamamlandı.')
      const owner = ORDER_STEP_OWNER[order.status]
      if (owner && request.user.role !== owner) {
        forbidden('Bu adımı yalnızca ilgili rol imzalayabilir.')
      }
      // Final approval gates the project again.
      if (next === 'onaylandi') {
        const proj = await getProjectForUpdate(client, order.project_id)
        if (proj && proj.stage === 'uretime_hazir') {
          assertCanEnterProduction('uretimde', proj.progress)
        }
      }
      // Assign step: persist designers on the order + project
      if (order.status === 'pending') {
        if (!Array.isArray(assignees) || assignees.length === 0) {
          badRequest('Tasarımcı seçmeden talebi aktaramazsın.')
        }
        for (const id of assignees) {
          const { rows: u } = await client.query('SELECT id, role, is_active FROM users WHERE id = $1', [id])
          if (!u[0]) badRequest(`Tasarımcı bulunamadı: ${id}`)
          if (u[0].role !== 'designer') badRequest(`Seçilen kullanıcı tasarımcı değil.`)
          if (u[0].is_active === false) badRequest(`Tasarımcı pasif durumda, atanamaz.`)
        }
        const proj = await getProjectForUpdate(client, order.project_id)
        if (proj) {
          const updated = await patchProject(client, proj.id, {
            assigned_to: assignees[0],
          })
          await logHistory(
            client,
            {
              project_id: proj.id,
              from_stage: proj.stage,
              to_stage: proj.stage,
              action: 'system',
              event: 'order_transfer',
              note: 'Sipariş aktarımı: tasarımcı atandı',
            },
            request.user,
          )
          void updated
        }
      }
      const { rows: updated } = await client.query(
        `UPDATE order_requests
           SET status = $2,
               assignee_ids = COALESCE($3::jsonb, assignee_ids),
               version = version + 1,
               updated_at = NOW()
         WHERE id = $1
         RETURNING id, project_id, status, requested_by, payload, assignee_ids,
                   version, created_at, updated_at`,
        [orderId, next, order.status === 'pending' ? JSON.stringify(assignees) : null],
      )
      await client.query(
        `INSERT INTO order_history (order_id, step, signed_by_id, notes)
         VALUES ($1,$2,$3,$4)`,
        [orderId, next, request.user.id, notes ?? ''],
      )
      // Mid-flow advance (designer → matbaa, or matbaa → leader) — log it
      // so the timeline pairs every order step with the signer.
      if (next !== 'onaylandi') {
        const proj = await getProjectForUpdate(client, order.project_id)
        if (proj) {
          await logHistory(
            client,
            {
              project_id: proj.id,
              from_stage: proj.stage,
              to_stage: proj.stage,
              action: 'system',
              event: 'order_advance',
              note: next === 'goruldu'
                ? 'Sipariş tasarımcıya aktarıldı'
                : next === 'tasarimci_onay'
                  ? 'Tasarımcı onayı verildi'
                  : next === 'matbaa_onay'
                    ? 'Matbaa teslimi yapıldı'
                    : `Sipariş adımı: ${next}`,
            },
            request.user,
          )
        }
      }
      // Final approval flips the project into uretimde.
      if (next === 'onaylandi') {
        const proj = await getProjectForUpdate(client, order.project_id)
        if (proj) {
          await patchProject(client, proj.id, { stage: 'uretimde' })
          await logHistory(
            client,
            {
              project_id: proj.id,
              from_stage: proj.stage,
              to_stage: 'uretimde',
              action: 'system',
              event: 'order_final',
              note: 'Sipariş onaylandı, üretime alındı',
            },
            request.user,
          )
        }
      }
      // Notify whoever owns the new step (or the requester on final approval).
      const nextOrder = updated[0]
      const assigneeIds = Array.isArray(assignees) && assignees.length > 0
        ? assignees
        : (Array.isArray(nextOrder.assignee_ids) ? nextOrder.assignee_ids : [])
      await notifyOrderTransition(client, {
        order: nextOrder, newStatus: next, actor: request.user,
        requesterId: order.requested_by, assigneeIds,
      })
      return nextOrder
    })
    return result
  })

  fastify.patch('/order-requests/:id/reject', { schema: schemas.ordersReject }, async (request) => {
    await attachUser(request)
    if (request.user.role !== 'team_leader') forbidden('Yalnızca takım lideri reddedebilir.')
    const { reason, rejectTarget = 'matbaa', revizeIds = [] } = request.body
    const orderId = request.params.id
    const result = await withTx(async (client) => {
      const { rows: orderRows } = await client.query(
        'SELECT * FROM order_requests WHERE id = $1 FOR UPDATE', [orderId],
      )
      const order = orderRows[0]
      if (!order) notFound('Talep bulunamadı.')
      const targetStatus = rejectTarget === 'matbaa' ? 'tasarimci_onay'
                          : rejectTarget === 'designer' ? 'goruldu'
                          : rejectTarget === 'reassign' ? 'pending'
                          : null
      if (!targetStatus) badRequest('Geçersiz red hedefi.')
      const { rows: updated } = await client.query(
        `UPDATE order_requests
           SET status = $2, version = version + 1, updated_at = NOW()
         WHERE id = $1
         RETURNING id, project_id, status, requested_by, payload, assignee_ids,
                   version, created_at, updated_at`,
        [orderId, targetStatus],
      )
      await client.query(
        `INSERT INTO order_history (order_id, step, signed_by_id, notes)
         VALUES ($1,$2,$3,$4)`,
        [orderId, `reject→${rejectTarget}`, request.user.id, reason],
      )
      // Flag the alt görevler the leader named, so the designer sees exactly
      // which parts to redo rather than just "reddedildi". Same contract as
      // the main pipeline's `applyRevize`: set needs_revize and leave is_done /
      // progress ALONE — the design work was done, it only needs a touch-up.
      // The designer clears each flag via POST /subtasks/:id/revize.
      //
      // Only on the 'designer' route: a 'matbaa' rejection re-delivers the same
      // design untouched, and 'reassign' hands the whole thing to a new team.
      // Scoped by project_id so an id from another project can't be flagged.
      let revized = []
      if (rejectTarget === 'designer' && revizeIds.length > 0) {
        const { rows } = await client.query(
          `UPDATE subtasks SET needs_revize = TRUE, updated_at = NOW()
            WHERE project_id = $1 AND id = ANY($2::text[])
            RETURNING title`,
          [order.project_id, revizeIds],
        )
        revized = rows.map((r) => r.title)
      }
      const proj = await getProjectForUpdate(client, order.project_id)
      if (proj) {
        await patchProject(client, proj.id, {
          ozalit_attempt: (proj.ozalit_attempt ?? 0) + 1,
        })
        await logHistory(
          client,
          {
            project_id: proj.id,
            from_stage: proj.stage,
            to_stage: proj.stage,
            action: 'reject',
            event: 'order_reject',
            reason,
            reject_target: rejectTarget,
            note: revized.length > 0
              ? `Sipariş reddedildi (${rejectTarget}), revize: ${revized.join(', ')}`
              : `Sipariş reddedildi (${rejectTarget})`,
          },
          request.user,
        )
      }
      // Tell the sales requester it bounced, and re-notify the owner of the
      // step the talep was sent back to so they can act.
      await notifyOrderRejected(client, {
        order: updated[0], project: proj, actor: request.user,
        requesterId: order.requested_by, reason,
      })
      await notifyOrderTransition(client, {
        order: updated[0], project: proj, newStatus: targetStatus, actor: request.user,
        requesterId: order.requested_by,
        assigneeIds: Array.isArray(updated[0].assignee_ids) ? updated[0].assignee_ids : [],
      })
      return updated[0]
    })
    return result
  })
}
