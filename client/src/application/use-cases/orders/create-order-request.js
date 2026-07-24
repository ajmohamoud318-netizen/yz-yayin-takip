import { httpClient } from '../../../infrastructure/http/client.js'

/**
 * Create a new sales-side order (sipariş talebi).
 *
 * Only allowed against finished books (`stage = satista`) — the server
 * enforces this in `server/src/domain/transitions.js`. See
 * `client/src/domain/constants/orders.js` for the workflow definition.
 */
export function makeCreateOrderRequest() {
  return function createOrderRequest(payload) {
    // The server's ordersCreate schema is additionalProperties: false and
    // rejects unknown keys with a 400 (see server/src/index.js's ajv config).
    // `projectTitle` and `requester` are caller-side convenience fields the
    // server never reads (it derives the requester from the auth token) —
    // forward only what the schema actually accepts.
    const { projectId, quantity, notes, payload: extra, items } = payload
    return httpClient
      .post('/order-requests', { projectId, quantity, notes, payload: extra, items })
      .then(({ data }) => data)
  }
}
