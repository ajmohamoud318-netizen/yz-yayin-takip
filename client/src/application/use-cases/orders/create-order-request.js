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
    return httpClient
      .post('/order-requests', payload)
      .then(({ data }) => data)
  }
}
