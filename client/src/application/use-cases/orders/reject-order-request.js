import { httpClient } from '../../../infrastructure/http/client.js'

/**
 * Reject a sales-side ozalit (matbaa_onay step) — loops the order back
 * to `tasarimci_onay` so Matbaa re-delivers. Server-side validation
 * handles the role/owner + reason gates.
 */
export function makeRejectOrderRequest() {
  return function rejectOrderRequest(id, { reason }) {
    return httpClient
      .patch(`/order-requests/${id}/reject`, { reason })
      .then(({ data }) => data)
  }
}
