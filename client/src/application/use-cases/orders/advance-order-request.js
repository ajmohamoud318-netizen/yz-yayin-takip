import { httpClient } from '../../../infrastructure/http/client.js'

/**
 * Cross-aggregate use case: advancing an order updates both the order
 * and the linked project's history (and stage on final approval).
 *
 * The state-machine guards (assignee validation, progress gate, role
 * ownership) all live server-side in `server/src/domain/transitions.js`
 * — this client wrapper is just the HTTP call.
 */
export function makeAdvanceOrderRequest() {
  return function advanceOrderRequest(id, { notes = '' } = {}) {
    return httpClient
      .patch(`/order-requests/${id}/advance`, { notes })
      .then(({ data }) => data)
  }
}
