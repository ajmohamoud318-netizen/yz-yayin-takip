import { nanoid } from 'nanoid'
import { attachUser } from '../middleware/auth.js'
import { badRequest, forbidden, notFound } from '../domain/errors.js'
import { withTx } from '../db/pool.js'
import { getPool } from '../db/pool.js'
import { ORDER_STEP_NEXT, ORDER_STEP_OWNER, ORDER_REJECT_TARGETS } from '../domain/orders.js'
import {
  computeMatbaaReceive, computeMatbaaNotReceived, computeMatbaaOnayApproval,
  computeOrderOzalitStart, computeOrderOzalitCancel, computeOrderOzalitEdit,
  computeOrderOzalitChangeRequest, computeOrderOzalitChangeAccept, computeOrderOzalitChangeDecline,
} from '../domain/order-transitions.js'
import {
  getProject, getProjectForUpdate, patchProject, logHistory,
} from '../services/project-repository.js'
import { assertOrderable, isAtOrPastStage } from '../domain/pipeline.js'
import { schemas } from '../schemas/index.js'
import {
  notifyOrderTransition, notifyOrderRejected, notifyMatbaaReceived, notifyMatbaaApprovalPending,
  notifyOrderOzalitStarted, notifyOrderOzalitCancelled, notifyOrderOzalitEdited,
  notifyOrderOzalitChangeRequested, notifyOrderOzalitChangeAccepted, notifyOrderOzalitChangeDeclined,
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
              o.ozalit_started, o.ozalit_started_by, o.ozalit_started_by_name, o.ozalit_started_at,
              o.ozalit_change_requested_at, o.ozalit_change_requested_by, o.ozalit_change_requested_by_name,
              o.ozalit_change_requested_note, o.ozalit_fix_pending,
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
        // tasarimci_onay is the printer's ozalit round (migration 051) — same
        // "must start, and resolve any pending change request, before
        // delivering" rule as the main pipeline's demo/ozalit Teslim Et
        // (computeDemoTeslimAdvance/computeOzalitTeslimAdvance). The client
        // hides the Teslim Edin button for these cases; this is the
        // server-side backstop.
        if (order.status === 'tasarimci_onay') {
          if (order.ozalit_change_requested_at != null) {
            badRequest('Bekleyen bir değişiklik talebi var, önce kabul veya reddedin.')
          }
          if (!order.ozalit_started) {
            badRequest('Teslim etmeden önce İşlemi Başlatın işaretlemelisiniz.')
          }
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
                   ozalit_started, ozalit_started_by, ozalit_started_by_name, ozalit_started_at,
                   ozalit_change_requested_at, ozalit_change_requested_by, ozalit_change_requested_by_name,
                   ozalit_change_requested_note, ozalit_fix_pending,
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
      const proj = await getProjectForUpdate(client, order.project_id)
      // A matbaa_onay click that doesn't complete the round still gets its
      // own project-timeline entry (mirrors the main pipeline's ozalit
      // partial-approval logging in POST /projects/:id/approve) — the
      // round-completing click (lands on siparis_baski_onay) is covered by
      // the generic mid-flow logging block just below instead.
      if (matbaaResult && !advancing) {
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
      //
      // Only when the click actually MOVED the order. A partial matbaa_onay
      // approval leaves it at matbaa_onay, but `next` is 'siparis_baski_onay'
      // either way — logging it unconditionally announced "Baskı onay formuna
      // gönderildi" on the project timeline after every single approval, while
      // the order was still waiting on the remaining approvers.
      if (advancing) {
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
        await notifyMatbaaApprovalPending(client, {
          order: nextOrder, project: proj, actor: request.user, teamLeaderIds, designerIds,
        })
      } else {
        await notifyOrderTransition(client, {
          order: nextOrder, project: proj, newStatus: next, actor: request.user,
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
                   ozalit_started, ozalit_started_by, ozalit_started_by_name, ozalit_started_at,
                   ozalit_change_requested_at, ozalit_change_requested_by, ozalit_change_requested_by_name,
                   ozalit_change_requested_note, ozalit_fix_pending,
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
               -- Re-entering tasarimci_onay is a fresh printer round — stale
               -- started/change-request state from the delivered-but-lost
               -- proof must not carry over (mirrors migration 048/049's
               -- same reset rule on the main pipeline).
               ozalit_started = FALSE, ozalit_started_at = NULL,
               ozalit_started_by = NULL, ozalit_started_by_name = NULL,
               ozalit_change_requested_at = NULL, ozalit_change_requested_by = NULL,
               ozalit_change_requested_by_name = NULL, ozalit_change_requested_note = NULL,
               ozalit_fix_pending = FALSE,
               version = version + 1, updated_at = NOW()
         WHERE id = $1
         RETURNING id, project_id, status, requested_by, payload, assignee_ids,
                   matbaa_received, matbaa_received_by, matbaa_received_at, matbaa_approvals,
                   ozalit_started, ozalit_started_by, ozalit_started_by_name, ozalit_started_at,
                   ozalit_change_requested_at, ozalit_change_requested_by, ozalit_change_requested_by_name,
                   ozalit_change_requested_note, ozalit_fix_pending,
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

  // Full parity with the main pipeline's demo/ozalit started/cancel/edit/
  // change-request flow (migrations 048/049), scoped to the order's own
  // ozalit round delivered at tasarimci_onay — see order-transitions.js for
  // the shared rationale. Every route here follows the same
  // SELECT...FOR UPDATE / compute / UPDATE / order_history / project
  // timeline / notify shape as matbaa-receive above.

  // Matbaa marks physical work begun. Idempotent (history: null on a
  // repeat click, same as matbaa-receive).
  fastify.post('/order-requests/:id/ozalit-start', { schema: schemas.ordersIdParams }, async (request) => {
    await attachUser(request)
    const orderId = request.params.id
    const result = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM order_requests WHERE id = $1 FOR UPDATE', [orderId])
      const order = rows[0]
      if (!order) notFound('Talep bulunamadı.')
      const { order: patch, history } = computeOrderOzalitStart(order, request.user)
      if (!history) {
        const { payload, ...rest } = order
        return rest
      }
      const { rows: updated } = await client.query(
        `UPDATE order_requests
           SET ozalit_started = $2, ozalit_started_by = $3, ozalit_started_by_name = $4, ozalit_started_at = $5,
               version = version + 1, updated_at = NOW()
         WHERE id = $1
         RETURNING id, project_id, status, requested_by, payload, assignee_ids,
                   matbaa_received, matbaa_received_by, matbaa_received_at, matbaa_approvals,
                   ozalit_started, ozalit_started_by, ozalit_started_by_name, ozalit_started_at,
                   ozalit_change_requested_at, ozalit_change_requested_by, ozalit_change_requested_by_name,
                   ozalit_change_requested_note, ozalit_fix_pending,
                   last_reject_type, baski_onay_form, version, created_at, updated_at`,
        [orderId, patch.ozalit_started, patch.ozalit_started_by, patch.ozalit_started_by_name, patch.ozalit_started_at],
      )
      await client.query(
        `INSERT INTO order_history (order_id, step, signed_by_id, notes) VALUES ($1,$2,$3,$4)`,
        [orderId, history.step, request.user.id, history.note],
      )
      const proj = await getProjectForUpdate(client, order.project_id)
      if (proj) {
        await logHistory(client, {
          project_id: proj.id, from_stage: proj.stage, to_stage: proj.stage,
          action: 'system', event: 'order_ozalit_started', note: history.note,
        }, request.user)
      }
      await notifyOrderOzalitStarted(client, { order: updated[0], project: proj, actor: request.user })
      return updated[0]
    })
    return result
  })

  // Team leader cancels a pending (not-yet-started) ozalit request outright
  // — back to goruldu, no attempt counter bump (nothing was delivered).
  fastify.post('/order-requests/:id/ozalit-cancel', { schema: schemas.ordersIdParams }, async (request) => {
    await attachUser(request)
    const orderId = request.params.id
    const result = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM order_requests WHERE id = $1 FOR UPDATE', [orderId])
      const order = rows[0]
      if (!order) notFound('Talep bulunamadı.')
      const { order: patch, history } = computeOrderOzalitCancel(order, request.user)
      const { rows: updated } = await client.query(
        `UPDATE order_requests
           SET status = $2,
               ozalit_started = FALSE, ozalit_started_at = NULL,
               ozalit_started_by = NULL, ozalit_started_by_name = NULL,
               ozalit_change_requested_at = NULL, ozalit_change_requested_by = NULL,
               ozalit_change_requested_by_name = NULL, ozalit_change_requested_note = NULL,
               ozalit_fix_pending = FALSE,
               version = version + 1, updated_at = NOW()
         WHERE id = $1
         RETURNING id, project_id, status, requested_by, payload, assignee_ids,
                   matbaa_received, matbaa_received_by, matbaa_received_at, matbaa_approvals,
                   ozalit_started, ozalit_started_by, ozalit_started_by_name, ozalit_started_at,
                   ozalit_change_requested_at, ozalit_change_requested_by, ozalit_change_requested_by_name,
                   ozalit_change_requested_note, ozalit_fix_pending,
                   last_reject_type, baski_onay_form, version, created_at, updated_at`,
        [orderId, patch.status],
      )
      await client.query(
        `INSERT INTO order_history (order_id, step, signed_by_id, notes) VALUES ($1,$2,$3,$4)`,
        [orderId, history.step, request.user.id, history.note],
      )
      const proj = await getProjectForUpdate(client, order.project_id)
      if (proj) {
        await logHistory(client, {
          project_id: proj.id, from_stage: proj.stage, to_stage: proj.stage,
          action: 'system', event: 'order_ozalit_cancelled', note: history.note,
        }, request.user)
      }
      await notifyOrderOzalitCancelled(client, { order: updated[0], project: proj, actor: request.user })
      return updated[0]
    })
    return result
  })

  // Team leader edits the product spec (saved separately via the shared
  // Ürün Bilgileri catalog — see saveProductComps on the client) while it's
  // still sitting with the matbaa, pre-start. This route only logs the
  // history/notify side, same split as the main pipeline's demo/ozalit edit.
  fastify.post('/order-requests/:id/ozalit-edit-notify', { schema: schemas.ordersIdParams }, async (request) => {
    await attachUser(request)
    const orderId = request.params.id
    const result = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM order_requests WHERE id = $1 FOR UPDATE', [orderId])
      const order = rows[0]
      if (!order) notFound('Talep bulunamadı.')
      const { order: patch, history } = computeOrderOzalitEdit(order, request.user)
      const { rows: updated } = await client.query(
        `UPDATE order_requests SET ozalit_fix_pending = $2, version = version + 1, updated_at = NOW()
         WHERE id = $1
         RETURNING id, project_id, status, requested_by, payload, assignee_ids,
                   matbaa_received, matbaa_received_by, matbaa_received_at, matbaa_approvals,
                   ozalit_started, ozalit_started_by, ozalit_started_by_name, ozalit_started_at,
                   ozalit_change_requested_at, ozalit_change_requested_by, ozalit_change_requested_by_name,
                   ozalit_change_requested_note, ozalit_fix_pending,
                   last_reject_type, baski_onay_form, version, created_at, updated_at`,
        [orderId, patch.ozalit_fix_pending],
      )
      await client.query(
        `INSERT INTO order_history (order_id, step, signed_by_id, notes) VALUES ($1,$2,$3,$4)`,
        [orderId, history.step, request.user.id, history.note],
      )
      const proj = await getProjectForUpdate(client, order.project_id)
      if (proj) {
        await logHistory(client, {
          project_id: proj.id, from_stage: proj.stage, to_stage: proj.stage,
          action: 'system', event: 'order_ozalit_edited', note: history.note,
        }, request.user)
      }
      await notifyOrderOzalitEdited(client, { order: updated[0], project: proj, actor: request.user })
      return updated[0]
    })
    return result
  })

  // Once the matbaa has started, cancel/edit is refused — the team leader
  // asks instead, and the printer accepts or declines below.
  fastify.post('/order-requests/:id/ozalit-change-request', { schema: schemas.ordersOzalitChangeRequest }, async (request) => {
    await attachUser(request)
    const orderId = request.params.id
    const { note } = request.body ?? {}
    const result = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM order_requests WHERE id = $1 FOR UPDATE', [orderId])
      const order = rows[0]
      if (!order) notFound('Talep bulunamadı.')
      const { order: patch, history } = computeOrderOzalitChangeRequest(order, request.user, { note })
      const { rows: updated } = await client.query(
        `UPDATE order_requests
           SET ozalit_change_requested_at = $2, ozalit_change_requested_by = $3,
               ozalit_change_requested_by_name = $4, ozalit_change_requested_note = $5,
               version = version + 1, updated_at = NOW()
         WHERE id = $1
         RETURNING id, project_id, status, requested_by, payload, assignee_ids,
                   matbaa_received, matbaa_received_by, matbaa_received_at, matbaa_approvals,
                   ozalit_started, ozalit_started_by, ozalit_started_by_name, ozalit_started_at,
                   ozalit_change_requested_at, ozalit_change_requested_by, ozalit_change_requested_by_name,
                   ozalit_change_requested_note, ozalit_fix_pending,
                   last_reject_type, baski_onay_form, version, created_at, updated_at`,
        [
          orderId, patch.ozalit_change_requested_at, patch.ozalit_change_requested_by,
          patch.ozalit_change_requested_by_name, patch.ozalit_change_requested_note,
        ],
      )
      await client.query(
        `INSERT INTO order_history (order_id, step, signed_by_id, notes) VALUES ($1,$2,$3,$4)`,
        [orderId, history.step, request.user.id, history.note],
      )
      const proj = await getProjectForUpdate(client, order.project_id)
      if (proj) {
        await logHistory(client, {
          project_id: proj.id, from_stage: proj.stage, to_stage: proj.stage,
          action: 'system', event: 'order_ozalit_change_requested', note: history.note,
        }, request.user)
      }
      await notifyOrderOzalitChangeRequested(client, {
        order: updated[0], project: proj, actor: request.user, note,
      })
      return updated[0]
    })
    return result
  })

  // Matbaa accepts the pending change-request: un-starts the round (reopens
  // free cancel/edit) and marks a fix owed before the matbaa can re-lock it.
  fastify.post('/order-requests/:id/ozalit-change-accept', { schema: schemas.ordersIdParams }, async (request) => {
    await attachUser(request)
    const orderId = request.params.id
    const result = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM order_requests WHERE id = $1 FOR UPDATE', [orderId])
      const order = rows[0]
      if (!order) notFound('Talep bulunamadı.')
      const { history } = computeOrderOzalitChangeAccept(order, request.user)
      const { rows: updated } = await client.query(
        `UPDATE order_requests
           SET ozalit_started = FALSE, ozalit_started_at = NULL,
               ozalit_started_by = NULL, ozalit_started_by_name = NULL,
               ozalit_change_requested_at = NULL, ozalit_change_requested_by = NULL,
               ozalit_change_requested_by_name = NULL, ozalit_change_requested_note = NULL,
               ozalit_fix_pending = TRUE,
               version = version + 1, updated_at = NOW()
         WHERE id = $1
         RETURNING id, project_id, status, requested_by, payload, assignee_ids,
                   matbaa_received, matbaa_received_by, matbaa_received_at, matbaa_approvals,
                   ozalit_started, ozalit_started_by, ozalit_started_by_name, ozalit_started_at,
                   ozalit_change_requested_at, ozalit_change_requested_by, ozalit_change_requested_by_name,
                   ozalit_change_requested_note, ozalit_fix_pending,
                   last_reject_type, baski_onay_form, version, created_at, updated_at`,
        [orderId],
      )
      await client.query(
        `INSERT INTO order_history (order_id, step, signed_by_id, notes) VALUES ($1,$2,$3,$4)`,
        [orderId, history.step, request.user.id, history.note],
      )
      const proj = await getProjectForUpdate(client, order.project_id)
      if (proj) {
        await logHistory(client, {
          project_id: proj.id, from_stage: proj.stage, to_stage: proj.stage,
          action: 'system', event: 'order_ozalit_change_accepted', note: history.note,
        }, request.user)
      }
      await notifyOrderOzalitChangeAccepted(client, { order: updated[0], project: proj, actor: request.user })
      return updated[0]
    })
    return result
  })

  // Matbaa declines the pending change-request: round stays started, nothing
  // else changes.
  fastify.post('/order-requests/:id/ozalit-change-decline', { schema: schemas.ordersIdParams }, async (request) => {
    await attachUser(request)
    const orderId = request.params.id
    const result = await withTx(async (client) => {
      const { rows } = await client.query('SELECT * FROM order_requests WHERE id = $1 FOR UPDATE', [orderId])
      const order = rows[0]
      if (!order) notFound('Talep bulunamadı.')
      const { history } = computeOrderOzalitChangeDecline(order, request.user)
      const { rows: updated } = await client.query(
        `UPDATE order_requests
           SET ozalit_change_requested_at = NULL, ozalit_change_requested_by = NULL,
               ozalit_change_requested_by_name = NULL, ozalit_change_requested_note = NULL,
               version = version + 1, updated_at = NOW()
         WHERE id = $1
         RETURNING id, project_id, status, requested_by, payload, assignee_ids,
                   matbaa_received, matbaa_received_by, matbaa_received_at, matbaa_approvals,
                   ozalit_started, ozalit_started_by, ozalit_started_by_name, ozalit_started_at,
                   ozalit_change_requested_at, ozalit_change_requested_by, ozalit_change_requested_by_name,
                   ozalit_change_requested_note, ozalit_fix_pending,
                   last_reject_type, baski_onay_form, version, created_at, updated_at`,
        [orderId],
      )
      await client.query(
        `INSERT INTO order_history (order_id, step, signed_by_id, notes) VALUES ($1,$2,$3,$4)`,
        [orderId, history.step, request.user.id, history.note],
      )
      const proj = await getProjectForUpdate(client, order.project_id)
      if (proj) {
        await logHistory(client, {
          project_id: proj.id, from_stage: proj.stage, to_stage: proj.stage,
          action: 'system', event: 'order_ozalit_change_declined', note: history.note,
        }, request.user)
      }
      await notifyOrderOzalitChangeDeclined(client, { order: updated[0], project: proj, actor: request.user })
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
               -- A rejection sends the order back for rework, physical or
               -- otherwise — any stale started/change-request state from
               -- the rejected round must not carry over into the next one.
               ozalit_started = FALSE, ozalit_started_at = NULL,
               ozalit_started_by = NULL, ozalit_started_by_name = NULL,
               ozalit_change_requested_at = NULL, ozalit_change_requested_by = NULL,
               ozalit_change_requested_by_name = NULL, ozalit_change_requested_note = NULL,
               ozalit_fix_pending = FALSE,
               version = version + 1, updated_at = NOW()
         WHERE id = $1
         RETURNING id, project_id, status, requested_by, payload, assignee_ids,
                   matbaa_received, matbaa_received_by, matbaa_received_at, matbaa_approvals,
                   ozalit_started, ozalit_started_by, ozalit_started_by_name, ozalit_started_at,
                   ozalit_change_requested_at, ozalit_change_requested_by, ozalit_change_requested_by_name,
                   ozalit_change_requested_note, ozalit_fix_pending,
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
           ozalit_started, ozalit_started_by, ozalit_started_by_name, ozalit_started_at,
           ozalit_change_requested_at, ozalit_change_requested_by, ozalit_change_requested_by_name,
           ozalit_change_requested_note, ozalit_fix_pending,
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
      // basimYeri is required here too (it is what the matbaa prints from);
      // the draft-save PATCH above deliberately stays partial-friendly.
      if (![adet, tarih, basimYeri, hazirlayan].every((v) => v?.trim())) {
        badRequest('Adet, tarih, basım yeri ve hazırlayan alanları zorunludur.')
      }
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
           ozalit_started, ozalit_started_by, ozalit_started_by_name, ozalit_started_at,
           ozalit_change_requested_at, ozalit_change_requested_by, ozalit_change_requested_by_name,
           ozalit_change_requested_note, ozalit_fix_pending,
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
