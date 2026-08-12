import { httpClient } from '../../../infrastructure/http/client.js'

/**
 * Reject a sales-side ozalit (matbaa_onay step) — loops the order back
 * to `tasarimci_onay` so Matbaa re-delivers. Server-side validation
 * handles the role/owner + reason gates.
 */
export function makeRejectOrderRequest() {
  return function rejectOrderRequest(id, { reason, routeTo, revizeIds }) {
    // The dialog's `routeTo` is the server's `rejectTarget` ('matbaa' |
    // 'designer' | 'reassign'). Dropping it here did not fail loudly — the
    // server just defaulted to 'matbaa', so picking "tasarımcıya geri gönder"
    // or "kadroyu yeniden seç" silently routed the order to Matbaa anyway.
    const body = { reason }
    if (routeTo !== undefined) body.rejectTarget = routeTo
    // Which alt görevler need redoing. Only the 'designer' route reworks the
    // design, so the selection is meaningless (and ignored server-side) on the
    // other two — don't send it there.
    if (routeTo === 'designer' && Array.isArray(revizeIds) && revizeIds.length > 0) {
      body.revizeIds = revizeIds
    }
    return httpClient
      .patch(`/order-requests/${id}/reject`, body)
      .then(({ data }) => data)
  }
}
