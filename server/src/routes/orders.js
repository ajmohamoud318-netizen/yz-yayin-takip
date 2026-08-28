import { attachUser } from '../middleware/auth.js'
import { schemas } from '../schemas/index.js'
import * as orders from '../services/orders-service.js'

/**
 * Sipariş talep workflow — HTTP adapter.
 *
 * GET    /api/order-requests
 * POST   /api/order-requests                            — satis only
 * PATCH  /api/order-requests/:id/advance                — owner of current step
 *                                                         (matbaa_onay: multi-party)
 * PATCH  /api/order-requests/:id/reject                 — team_leader only
 * POST   /api/order-requests/:id/matbaa-receive         — mark delivered ozalit "Teslim Alındı"
 * POST   /api/order-requests/:id/matbaa-not-received    — report it never arrived
 * POST   /api/order-requests/:id/ozalit-start           — matbaa marks work begun
 * POST   /api/order-requests/:id/ozalit-cancel          — leader drops a not-yet-started round
 * POST   /api/order-requests/:id/ozalit-edit-notify     — leader corrects the sheet, pre-start
 * POST   /api/order-requests/:id/ozalit-change-request  — leader asks, post-start
 * POST   /api/order-requests/:id/ozalit-change-accept   — matbaa accepts the ask
 * POST   /api/order-requests/:id/ozalit-change-decline  — matbaa declines the ask
 * PATCH  /api/order-requests/:id/baski-onay-form        — save the print-spec draft
 * POST   /api/order-requests/:id/baski-onay-approve     — approve it, order → onaylandi
 * PATCH  /api/order-requests/:orderId/subtasks/:id      — toggle one alt görev row
 *
 * Every handler is a pure adapter: authenticate, hand the request to
 * `services/orders-service.js`, return what it gives back. The workflow
 * rules live in `domain/entities/Order.js`, persistence in
 * `services/order-repository.js`. Domain errors (`domain/errors.js`)
 * propagate to the global error handler in `index.js`.
 */
export async function orderRoutes(fastify) {
  fastify.get('/order-requests', async (request) => {
    await attachUser(request)
    return orders.listOrders()
  })

  fastify.post('/order-requests', { schema: schemas.ordersCreate }, async (request) => {
    await attachUser(request)
    return orders.createOrder(request.user, request.body)
  })

  fastify.patch('/order-requests/:id/advance', { schema: schemas.ordersAdvance }, async (request) => {
    await attachUser(request)
    return orders.advanceOrder(request.params.id, request.user, request.body)
  })

  fastify.post('/order-requests/:id/matbaa-receive', { schema: schemas.ordersIdParams }, async (request) => {
    await attachUser(request)
    return orders.receiveMatbaaOzalit(request.params.id, request.user)
  })

  fastify.post('/order-requests/:id/matbaa-not-received', { schema: schemas.ordersIdParams }, async (request) => {
    await attachUser(request)
    return orders.markMatbaaNotReceived(request.params.id, request.user)
  })

  fastify.post('/order-requests/:id/ozalit-start', { schema: schemas.ordersIdParams }, async (request) => {
    await attachUser(request)
    return orders.startOzalit(request.params.id, request.user)
  })

  fastify.post('/order-requests/:id/ozalit-cancel', { schema: schemas.ordersIdParams }, async (request) => {
    await attachUser(request)
    return orders.cancelOzalit(request.params.id, request.user)
  })

  fastify.post('/order-requests/:id/ozalit-edit-notify', { schema: schemas.ordersOzalitEditNotify }, async (request) => {
    await attachUser(request)
    return orders.editOzalit(request.params.id, request.user, request.body ?? {})
  })

  fastify.post('/order-requests/:id/ozalit-change-request', { schema: schemas.ordersOzalitChangeRequest }, async (request) => {
    await attachUser(request)
    return orders.requestOzalitChange(request.params.id, request.user, request.body ?? {})
  })

  fastify.post('/order-requests/:id/ozalit-change-accept', { schema: schemas.ordersIdParams }, async (request) => {
    await attachUser(request)
    return orders.acceptOzalitChange(request.params.id, request.user)
  })

  fastify.post('/order-requests/:id/ozalit-change-decline', { schema: schemas.ordersIdParams }, async (request) => {
    await attachUser(request)
    return orders.declineOzalitChange(request.params.id, request.user)
  })

  fastify.patch('/order-requests/:id/reject', { schema: schemas.ordersReject }, async (request) => {
    await attachUser(request)
    return orders.rejectOrder(request.params.id, request.user, request.body)
  })

  fastify.patch('/order-requests/:id/baski-onay-form', { schema: schemas.ordersBaskiOnayForm }, async (request) => {
    await attachUser(request)
    return orders.saveBaskiOnayForm(request.params.id, request.user, request.body)
  })

  fastify.post('/order-requests/:id/baski-onay-approve', { schema: schemas.ordersBaskiOnayForm }, async (request) => {
    await attachUser(request)
    return orders.approveBaskiOnayForm(request.params.id, request.user, request.body)
  })

  fastify.patch('/order-requests/:orderId/subtasks/:id', { schema: schemas.orderSubtasksPatch }, async (request) => {
    await attachUser(request)
    const { orderId, id } = request.params
    return orders.patchOrderSubtask(orderId, id, request.user, request.body)
  })
}
