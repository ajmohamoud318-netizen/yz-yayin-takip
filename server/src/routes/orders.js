import { nanoid } from 'nanoid'
import { attachUser } from '../middleware/auth.js'
import { badRequest, forbidden, notFound } from '../domain/errors.js'
import { withTx } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { ORDER_STEP_NEXT, ORDER_STEP_OWNER, ORDER_REJECT_TARGETS } from '../domain/orders.js'
import {
  computeMatbaaReceive, computeMatbaaNotReceived, computeMatbaaOnayApproval,
} from '../domain/order-transitions.js'
import {
  getProject, getProjectForUpdate, patchProject, logHistory,
} from '../services/project-repository.js'
import { assertOrderable, isAtOrPastStage } from '../domain/pipeline.js'
import { schemas } from '../schemas/index.js'
import {
  notifyOrderTransition, notifyOrderRejected, notifyMatbaaReceived, notifyMatbaaApprovalPending,
} from '../services/notifications.js'

/**
 * Sipariş talep workflow.
 *
 * GET    /api/order-requests
 * POST   /api/order-requests                      — satis only
 * PATCH  /api/order-requests/:id/advance           — owner of current step
 *                                                     (matbaa_onay: multi-party, see below)
 * PATCH  /api/order-requests/:id/reject            — team_leader only
 * POST   /api/order-requests/:id/matbaa-receive        — mark delivered ozalit "Teslim Alındı"
 * POST   /api/order-requests/:id/matbaa-not-received   — report it never arrived
 *
 * matbaa_onay is the sales-side twin of the main pipeline's ozalit_onay
 * (see `domain/order-transitions.js`): every active team leader AND every
 * order assignee must approve, leader-first, gated on the delivered proof
 * being marked "Teslim Alındı" first. Every other step stays a flat
 * single-owner advance via ORDER_STEP_OWNER.
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
              o.matbaa_received, o.matbaa_received_by, o.matbaa_received_at, o.matbaa_approvals,
              o.last_reject_type, o.baski_onay_form,
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
                u.name AS signed_by_name, u.role AS signed_by_role
           FROM order_history oh
           LEFT JOIN users u ON u.id = oh.signed_by_id
          WHERE oh.order_id = $1 ORDER BY oh.created_at`,
        [row.id],
      )
      // The order's own snapshot of the project's alt görevler — see
      // migration 039. Named `subtasks` (not `order_subtasks`) so the
      // client can read it the same way it used to read `project.subtasks`.
      const { rows: subs } = await getPool().query(
        `SELECT id, order_id, source_subtask_id, title, kind, is_done, total_pages,
                pages_done, total_stickers, stickers_done, done_at, needs_revize,
                position, created_at, updated_at
           FROM order_subtasks
          WHERE order_id = $1
          ORDER BY position, created_at`,
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
        subtasks: subs,
        order_history: hist.map((h) => ({
          step: h.step,
          notes: h.notes,
          signed_by_id: h.signed_by_id,
          signed_by_name: h.signed_by_name,
          // The signer's CURRENT role (not their role at signing time — same
          // approximation the approval gate itself uses, reloading active
          // team_leader ids fresh on every click rather than pinning history).
          // Lets the print/history views tell a team leader's signature apart
          // from a designer's on a matbaa_onay step that either could have
          // completed (see leaderSigner in TalepSignDialog.jsx).
          signed_by_role: h.signed_by_role,
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
    if (request.user.role !== 'satis') forbidden('Yalnızca satış baskı oluşturabilir.')
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
      // Snapshot the project's current alt görevler onto this order so it
      // never shares rework tracking with another concurrent order on the
      // same project — see migration 039.
      await client.query(
        `INSERT INTO order_subtasks
           (order_id, source_subtask_id, title, kind, is_done, total_pages, pages_done,
            total_stickers, stickers_done, done_at, needs_revize, position)
         SELECT $1, s.id, s.title, s.kind, s.is_done, s.total_pages, s.pages_done,
                s.total_stickers, s.stickers_done, s.done_at, s.needs_revize, s.position
           FROM subtasks s
          WHERE s.project_id = $2`,
        [order.id, projectId],
      )
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
          note: 'Baskı talebi oluşturuldu',
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
    const { notes = '', assignees = null, expectedVersion = null, route: chosenRoute = null } = request.body
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
      // siparis_baski_onay has its own dedicated form-fill-then-approve
      // routes (POST .../baski-onay-form, POST .../baski-onay-approve) — a
      // bare advance click can't move it forward.
      if (order.status === 'siparis_baski_onay') {
        badRequest('Bu adımda ilerlemek için baskı onay formunu doldurup onaylamalısınız.')
      }
      let next = ORDER_STEP_NEXT[order.status]
      if (!next) badRequest('Bu talep zaten tamamlandı.')

      // goruldu's next step is a fixed 'tasarimci_onay' on a first
      // submission. Only on a RESUBMIT (order.last_reject_type === 'designer'
      // — set by a prior reject-to-designer, see PATCH .../reject) does the
      // designer get to choose between another physical ozalit and a digital
      // Ekran Onayı. clearResubmitFlag is set whenever the order leaves
      // goruldu at all, resubmit or not — the flag only ever needs to
      // survive for the one click it gates.
      let clearResubmitFlag = false
      if (order.status === 'goruldu') {
        const isResubmit = order.last_reject_type === 'designer'
        if (chosenRoute != null && !isResubmit) {
          badRequest('İlk gönderimde onay seçimi yapılamaz.')
        }
        if (isResubmit) {
          if (!chosenRoute) {
            badRequest('Revize sonrası Ozalit mi yoksa Ekran Onayı mı isteneceğini seçmelisiniz.')
          }
          next = chosenRoute
        }
        clearResubmitFlag = true
      }

      // matbaa_onay is multi-party (every active team leader + every order
      // assignee), leader-first — not a flat single-owner step, so it's
      // special-cased before ORDER_STEP_OWNER is ever consulted, exactly the
      // way the main pipeline dispatches ozalit_onay before canApproveAt.
      let matbaaResult = null
      let teamLeaderIds = []
      let designerIds = []
      if (order.status === 'matbaa_onay') {
        designerIds = Array.isArray(order.assignee_ids) ? order.assignee_ids : []
        const { rows: leaderRows } = await client.query(
          "SELECT id FROM users WHERE role = 'team_leader' AND is_active = TRUE",
        )
        teamLeaderIds = leaderRows.map((r) => r.id)
        matbaaResult = computeMatbaaOnayApproval(order, request.user, { teamLeaderIds, designerIds })
      } else {
        const owner = ORDER_STEP_OWNER[order.status]
        if (owner && request.user.role !== owner) {
          forbidden('Bu adımı yalnızca ilgili rol imzalayabilir.')
        }
      }
      // Whether THIS click completes the round. For every non-matbaa_onay
      // step it's always true; for matbaa_onay it's only true once every
      // required approver has signed.
      const advancing = matbaaResult ? matbaaResult.advanced : true
      const statusToSet = advancing ? next : order.status

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
        // Only logged on the project timeline — deliberately does NOT write
        // projects.assigned_to. That field is project-wide, and two
        // concurrent orders transferring to different designers would stomp
        // each other's write. The order's own assignee_ids (set below) is
        // the authoritative ownership record for this order; designer
        // queues already filter on it (isOrderAssignedToDesigner), not on
        // project assignment.
        const proj = await getProjectForUpdate(client, order.project_id)
        if (proj) {
          await logHistory(
            client,
            {
              project_id: proj.id,
              from_stage: proj.stage,
              to_stage: proj.stage,
              action: 'system',
              event: 'order_transfer',
              note: 'Baskı aktarımı: tasarımcı atandı',
            },
            request.user,
          )
        }
      }
      const { rows: updated } = await client.query(
        `UPDATE order_requests
           SET status = $2,
               assignee_ids = COALESCE($3::jsonb, assignee_ids),
               matbaa_approvals = COALESCE($4::jsonb, matbaa_approvals),
               last_reject_type = CASE WHEN $5 THEN NULL ELSE last_reject_type END,
               version = version + 1,
               updated_at = NOW()
         WHERE id = $1
         RETURNING id, project_id, status, requested_by, payload, assignee_ids,
                   matbaa_received, matbaa_received_by, matbaa_received_at, matbaa_approvals,
                   last_reject_type, baski_onay_form, version, created_at, updated_at`,
        [
          orderId, statusToSet,
          order.status === 'pending' ? JSON.stringify(assignees) : null,
          matbaaResult ? JSON.stringify(matbaaResult.order.matbaa_approvals) : null,
          clearResubmitFlag,
        ],
      )
      // matbaa_onay uses its own step/note (partial approval note, or the
      // completing approval's "siparis_baski_onay" step); every other status
      // uses the plain next-step name, as before.
      const historyStep = matbaaResult ? matbaaResult.history.step : next
      const historyNote = matbaaResult
        ? (notes ? `${notes} · ${matbaaResult.history.note}` : matbaaResult.history.note)
        : (notes ?? '')
      await client.query(
        `INSERT INTO order_history (order_id, step, signed_by_id, notes)
         VALUES ($1,$2,$3,$4)`,
        [orderId, historyStep, request.user.id, historyNote],
      )
      // A matbaa_onay click that doesn't complete the round still gets its
      // own project-timeline entry (mirrors the main pipeline's ozalit
      // partial-approval logging in POST /projects/:id/approve) — the
      // round-completing click (lands on siparis_baski_onay) is covered by
      // the generic mid-flow logging block just below instead.
      if (matbaaResult && !advancing) {
        const proj = await getProjectForUpdate(client, order.project_id)
        if (proj) {
          await logHistory(
            client,
            {
              project_id: proj.id,
              from_stage: proj.stage,
              to_stage: proj.stage,
              action: 'approve',
              event: 'order_matbaa_approve',
              note: matbaaResult.history.note,
            },
            request.user,
          )
        }
      }
      // Mid-flow advance (designer → matbaa, matbaa → leader, etc.) — log it
      // so the timeline pairs every order step with the signer. `next` can
      // never be 'onaylandi' from this route any more — that transition
      // only happens via POST .../baski-onay-approve (see below).
      {
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
                ? 'Baskı tasarımcıya aktarıldı'
                : next === 'tasarimci_onay'
                  ? 'Tasarımcı onayı verildi'
                  : next === 'ekran_onay'
                    ? 'Baskı ekran onayına gönderildi'
                    : next === 'matbaa_onay'
                      ? 'Matbaa teslimi yapıldı'
                      : next === 'siparis_baski_onay'
                        ? 'Baskı onay formuna gönderildi'
                        : `Baskı adımı: ${next}`,
            },
            request.user,
          )
        }
      }
      // Notify whoever owns the new step (or the requester on final
      // approval). A matbaa_onay click that doesn't complete the round pings
      // whoever still owes an approval instead — notifyOrderTransition's
      // entry-ping would otherwise wrongly re-announce the delivery to every
      // team leader, including the one who just signed.
      const nextOrder = updated[0]
      const assigneeIds = Array.isArray(assignees) && assignees.length > 0
        ? assignees
        : (Array.isArray(nextOrder.assignee_ids) ? nextOrder.assignee_ids : [])
      if (matbaaResult && !advancing) {
        const proj = await getProjectForUpdate(client, order.project_id)
        await notifyMatbaaApprovalPending(client, {
          order: nextOrder, project: proj, actor: request.user, teamLeaderIds, designerIds,
        })
      } else {
        await notifyOrderTransition(client, {
          order: nextOrder, newStatus: next, actor: request.user,
          requesterId: order.requested_by, assigneeIds,
        })
      }
      return nextOrder
    })
    return result
  })

  // Mark a delivered matbaa ozalit "Teslim Alındı" (received) — the gate
  // before the multi-party matbaa onay. Allowed for the team leader or an
  // order assignee, only at matbaa_onay. Twin of POST /projects/:id/ozalit-receive.
  fastify.post('/order-requests/:id/matbaa-receive', { schema: schemas.ordersIdParams }, async (request) => {
    await attachUser(request)
    const orderId = request.params.id
    const result = await withTx(async (client) => {
      const { rows: orderRows } = await client.query(
        'SELECT * FROM order_requests WHERE id = $1 FOR UPDATE', [orderId],
      )
      const order = orderRows[0]
      if (!order) notFound('Talep bulunamadı.')
      const designerIds = Array.isArray(order.assignee_ids) ? order.assignee_ids : []
      const { order: patch, history } = computeMatbaaReceive(order, request.user, { designerIds })
      // Idempotent — already acknowledged, nothing to persist or notify.
      if (!history) {
        const { payload, ...rest } = order
        return rest
      }
      const { rows: updated } = await client.query(
        `UPDATE order_requests
           SET matbaa_received = $2, matbaa_received_by = $3, matbaa_received_at = $4,
               version = version + 1, updated_at = NOW()
         WHERE id = $1
         RETURNING id, project_id, status, requested_by, payload, assignee_ids,
                   matbaa_received, matbaa_received_by, matbaa_received_at, matbaa_approvals,
                   last_reject_type, baski_onay_form, version, created_at, updated_at`,
        [orderId, patch.matbaa_received, patch.matbaa_received_by, patch.matbaa_received_at],
      )
      await client.query(
        `INSERT INTO order_history (order_id, step, signed_by_id, notes)
         VALUES ($1,$2,$3,$4)`,
        [orderId, history.step, request.user.id, history.note],
      )
      const proj = await getProjectForUpdate(client, order.project_id)
      if (proj) {
        await logHistory(
          client,
          {
            project_id: proj.id,
            from_stage: proj.stage,
            to_stage: proj.stage,
            action: 'system',
            event: 'order_matbaa_received',
            note: history.note,
          },
          request.user,
        )
      }
      await notifyMatbaaReceived(client, {
        order: updated[0], project: proj, actor: request.user, assigneeIds: designerIds,
      })
      return updated[0]
    })
    return result
  })

  // Report that a delivered matbaa ozalit never actually reached the
  // leader/designer — sends it back to tasarimci_onay for re-delivery, wiping
  // any partial approval ledger. Counterpart to /matbaa-receive; only valid
  // before matbaa_received is set.
  fastify.post('/order-requests/:id/matbaa-not-received', { schema: schemas.ordersIdParams }, async (request) => {
    await attachUser(request)
    const orderId = request.params.id
    const result = await withTx(async (client) => {
      const { rows: orderRows } = await client.query(
        'SELECT * FROM order_requests WHERE id = $1 FOR UPDATE', [orderId],
      )
      const order = orderRows[0]
      if (!order) notFound('Talep bulunamadı.')
      const designerIds = Array.isArray(order.assignee_ids) ? order.assignee_ids : []
      const { order: patch, history } = computeMatbaaNotReceived(order, request.user, { designerIds })
      const { rows: updated } = await client.query(
        `UPDATE order_requests
           SET status = $2,
               matbaa_received = $3, matbaa_received_by = $4, matbaa_received_at = $5,
               matbaa_approvals = $6::jsonb,
               version = version + 1, updated_at = NOW()
         WHERE id = $1
         RETURNING id, project_id, status, requested_by, payload, assignee_ids,
                   matbaa_received, matbaa_received_by, matbaa_received_at, matbaa_approvals,
                   last_reject_type, baski_onay_form, version, created_at, updated_at`,
        [
          orderId, patch.status, patch.matbaa_received, patch.matbaa_received_by,
          patch.matbaa_received_at, JSON.stringify(patch.matbaa_approvals),
        ],
      )
      await client.query(
        `INSERT INTO order_history (order_id, step, signed_by_id, notes)
         VALUES ($1,$2,$3,$4)`,
        [orderId, history.step, request.user.id, history.note],
      )
      const proj = await getProjectForUpdate(client, order.project_id)
      if (proj) {
        // Bumps the attempt counter, same as a matbaa-target rejection —
        // a fresh proof is a new ozalit round for the project too.
        await patchProject(client, proj.id, { ozalit_attempt: (proj.ozalit_attempt ?? 0) + 1 })
        await logHistory(
          client,
          {
            project_id: proj.id,
            from_stage: proj.stage,
            to_stage: proj.stage,
            action: 'system',
            event: 'order_matbaa_not_received',
            note: history.note,
          },
          request.user,
        )
      }
      // Order re-enters tasarimci_onay — same "printer must re-deliver" ping
      // as any other transition landing there.
      await notifyOrderTransition(client, {
        order: updated[0], project: proj, newStatus: 'tasarimci_onay', actor: request.user,
        requesterId: order.requested_by,
      })
      return updated[0]
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
      const targets = ORDER_REJECT_TARGETS[order.status]
      if (!targets) badRequest('Bu aşamada red işlemi yapılamaz.')
      const targetStatus = targets[rejectTarget]
      if (!targetStatus) badRequest('Geçersiz red hedefi.')
      // Operates on an order sitting at matbaa_onay OR ekran_onay — wipe the
      // receipt gate and the partial approval ledger unconditionally, same
      // as a leader rejection wiping ozalit_approvals: a re-delivered proof
      // needs fresh sign-off. ekran_onay never set matbaa_received/
      // matbaa_approvals in the first place, so this is a harmless no-op
      // for that source step.
      const { rows: updated } = await client.query(
        `UPDATE order_requests
           SET status = $2,
               matbaa_received = FALSE, matbaa_received_by = NULL, matbaa_received_at = NULL,
               matbaa_approvals = '[]'::jsonb,
               last_reject_type = CASE WHEN $3 = 'designer' THEN 'designer' ELSE last_reject_type END,
               version = version + 1, updated_at = NOW()
         WHERE id = $1
         RETURNING id, project_id, status, requested_by, payload, assignee_ids,
                   matbaa_received, matbaa_received_by, matbaa_received_at, matbaa_approvals,
                   last_reject_type, baski_onay_form, version, created_at, updated_at`,
        [orderId, targetStatus, rejectTarget],
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
      // The designer clears each flag via PATCH /order-requests/:id/subtasks/:id.
      //
      // Only on the 'designer' route: a 'matbaa' rejection re-delivers the same
      // design untouched, and 'reassign' hands the whole thing to a new team.
      // Scoped by order_id (this order's own checklist snapshot — see
      // migration 039), so an id from another order or from the live
      // `subtasks` table can't be flagged.
      let revized = []
      if (rejectTarget === 'designer' && revizeIds.length > 0) {
        const { rows } = await client.query(
          `UPDATE order_subtasks SET needs_revize = TRUE, updated_at = NOW()
            WHERE order_id = $1 AND id = ANY($2::text[])
            RETURNING title`,
          [orderId, revizeIds],
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
              ? `Baskı reddedildi (${rejectTarget}), revize: ${revized.join(', ')}`
              : `Baskı reddedildi (${rejectTarget})`,
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

  // Save a draft of the siparis_baski_onay print-spec form without
  // advancing. team_leader only, only while the order is at
  // siparis_baski_onay. Twin of PATCH /projects/:id (baski_onay fields),
  // but order-scoped: the form snapshot lives entirely on order_requests,
  // not the shared demos table (see migration 046).
  fastify.patch('/order-requests/:id/baski-onay-form', { schema: schemas.ordersBaskiOnayForm }, async (request) => {
    await attachUser(request)
    if (request.user.role !== 'team_leader') forbidden('Baskı onay formunu yalnızca ekip lideri düzenleyebilir.')
    const orderId = request.params.id
    const result = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM order_requests WHERE id = $1 FOR UPDATE', [orderId])
      const order = rows[0]
      if (!order) notFound('Talep bulunamadı.')
      if (order.status !== 'siparis_baski_onay') badRequest('Baskı onay formu yalnızca bu aşamada düzenlenebilir.')
      const { components, adet, tarih, basimYeri, hazirlayan, notes } = request.body
      const nextForm = {
        ...order.baski_onay_form, components, adet, tarih, basimYeri, hazirlayan, notes,
        saved_by: request.user.id, saved_by_name: request.user.name, saved_at: new Date().toISOString(),
      }
      const { rows: updated } = await client.query(
        `UPDATE order_requests SET baski_onay_form = $2::jsonb, version = version + 1, updated_at = NOW()
         WHERE id = $1 RETURNING id, project_id, status, requested_by, payload, assignee_ids,
           matbaa_received, matbaa_received_by, matbaa_received_at, matbaa_approvals,
           last_reject_type, baski_onay_form, version, created_at, updated_at`,
        [orderId, JSON.stringify(nextForm)],
      )
      return updated[0]
    })
    return result
  })

  // Approve the siparis_baski_onay form — saves the final snapshot AND
  // advances the order to onaylandi in one action. team_leader only. This
  // is the ONLY route that can move an order to onaylandi / flip the linked
  // project into baskida — PATCH .../advance explicitly refuses to touch
  // siparis_baski_onay (see above).
  fastify.post('/order-requests/:id/baski-onay-approve', { schema: schemas.ordersBaskiOnayForm }, async (request) => {
    await attachUser(request)
    if (request.user.role !== 'team_leader') forbidden('Baskı onayını yalnızca ekip lideri verebilir.')
    const orderId = request.params.id
    const result = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM order_requests WHERE id = $1 FOR UPDATE', [orderId])
      const order = rows[0]
      if (!order) notFound('Talep bulunamadı.')
      if (order.status !== 'siparis_baski_onay') badRequest('Bu işlem yalnızca baskı onay aşamasında yapılabilir.')
      const { components, adet, tarih, basimYeri, hazirlayan, notes = '' } = request.body
      if (!adet || !tarih || !hazirlayan) badRequest('Adet, tarih ve hazırlayan alanları zorunludur.')
      const now = new Date().toISOString()
      const finalForm = {
        ...order.baski_onay_form, components, adet, tarih, basimYeri, hazirlayan,
        approved_by: request.user.id, approved_by_name: request.user.name, approved_at: now,
      }
      const { rows: updated } = await client.query(
        `UPDATE order_requests SET status = 'onaylandi', baski_onay_form = $2::jsonb,
                version = version + 1, updated_at = NOW()
         WHERE id = $1 RETURNING id, project_id, status, requested_by, payload, assignee_ids,
           matbaa_received, matbaa_received_by, matbaa_received_at, matbaa_approvals,
           last_reject_type, baski_onay_form, version, created_at, updated_at`,
        [orderId, JSON.stringify(finalForm)],
      )
      await client.query(
        `INSERT INTO order_history (order_id, step, signed_by_id, notes) VALUES ($1,'onaylandi',$2,$3)`,
        [orderId, request.user.id, notes ? `${notes} · Baskı onaylandı` : 'Baskı onaylandı'],
      )
      // Final approval flips the project into baskida — but only forward.
      // A second concurrent order on the same project can finish after the
      // project has already moved past baskida (via the first order, or
      // the main pipeline), and must not regress it. Mirrors the block that
      // used to live in PATCH .../advance before siparis_baski_onay existed.
      const proj = await getProjectForUpdate(client, order.project_id)
      if (proj) {
        if (!isAtOrPastStage(proj, 'baskida')) {
          await patchProject(client, proj.id, { stage: 'baskida' })
          await logHistory(client, {
            project_id: proj.id, from_stage: proj.stage, to_stage: 'baskida',
            action: 'system', event: 'order_final', note: 'Baskı onaylandı, baskıya alındı',
          }, request.user)
        } else {
          await logHistory(client, {
            project_id: proj.id, from_stage: proj.stage, to_stage: proj.stage,
            action: 'system', event: 'order_final',
            note: 'Baskı onaylandı (proje zaten baskıda veya sonrasında)',
          }, request.user)
        }
      }
      await notifyOrderTransition(client, {
        order: updated[0], project: proj, newStatus: 'onaylandi', actor: request.user,
        requesterId: order.requested_by,
      })
      return updated[0]
    })
    return result
  })

  // Toggle a single row of this order's own alt görevler snapshot
  // (order_subtasks — see migration 039). Twin of PATCH /subtasks/:id, but
  // gated on order.assignee_ids (an order can have several designers)
  // instead of a per-row assigned_to.
  fastify.patch('/order-requests/:orderId/subtasks/:id', { schema: schemas.orderSubtasksPatch }, async (request) => {
    await attachUser(request)
    const { orderId, id } = request.params
    const result = await withTx(async (client) => {
      const { rows: orderRows } = await client.query(
        'SELECT id, assignee_ids FROM order_requests WHERE id = $1 FOR UPDATE', [orderId],
      )
      const order = orderRows[0]
      if (!order) notFound('Talep bulunamadı.')

      const { rows: subRows } = await client.query(
        'SELECT * FROM order_subtasks WHERE id = $1 AND order_id = $2 FOR UPDATE',
        [id, orderId],
      )
      const sub = subRows[0]
      if (!sub) notFound('Alt görev bulunamadı.')

      const allowed = {}
      if (typeof request.body.is_done === 'boolean') {
        allowed.is_done = request.body.is_done
        allowed.done_at = request.body.is_done ? new Date().toISOString() : null
      }
      if (Number.isFinite(request.body.pages_done)) {
        if (sub.total_pages != null && request.body.pages_done > sub.total_pages) {
          badRequest(`İç sayfalar toplam iç sayfa sayısını (${sub.total_pages}) aşamaz.`)
        }
        allowed.pages_done = request.body.pages_done
      }
      if (Number.isFinite(request.body.stickers_done)) {
        if (sub.total_stickers != null && request.body.stickers_done > sub.total_stickers) {
          badRequest(`Etiket sayısı toplam etiket sayısını (${sub.total_stickers}) aşamaz.`)
        }
        allowed.stickers_done = request.body.stickers_done
      }
      if (typeof request.body.needs_revize === 'boolean') {
        if (request.user.role !== 'designer') {
          badRequest('Revize işaretini yalnızca tasarımcı değiştirebilir.')
        }
        const assignees = Array.isArray(order.assignee_ids) ? order.assignee_ids : []
        if (assignees.length > 0 && !assignees.includes(request.user.id)) {
          badRequest('Bu baskı size atanmadı.')
        }
        allowed.needs_revize = request.body.needs_revize
      }
      if (Object.keys(allowed).length === 0) badRequest('Geçerli alan yok.')

      const cols = Object.keys(allowed)
      const setSql = cols.map((c, i) => `${c} = $${i + 2}`).join(', ')
      const { rows: updatedSub } = await client.query(
        `UPDATE order_subtasks SET ${setSql}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [sub.id, ...cols.map((c) => allowed[c])],
      )
      return updatedSub[0]
    })
    return result
  })
}
