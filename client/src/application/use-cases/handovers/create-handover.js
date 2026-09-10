import { httpClient } from '../../../infrastructure/http/client.js'

/**
 * Matbaa raises a handover ("teslim") request. Two kinds, exactly one id
 * (migration 081):
 *
 *   { projectId } — the project's own teslim: production of the title itself
 *                   is finished (TR: Baskıda, ÇİN: Gümrük). Confirming it puts
 *                   the book on sale.
 *   { orderId }   — one sipariş's print run: a reprint of a title already at
 *                   or past baskıda, whose approval deliberately left the
 *                   project's stage alone. Confirming it closes the order.
 *
 * One pending request per project and per order — the server enforces the
 * eligibility, the duplicate guard, and that exactly one id is sent.
 */
export function makeCreateHandover() {
  return function createHandover({ projectId, orderId } = {}) {
    // Only ever send the one the caller meant: the body schema is `oneOf`, so
    // a stray `orderId: undefined` alongside a projectId is fine, but an
    // explicit null would be an unknown-property 400.
    const body = orderId ? { orderId } : { projectId }
    return httpClient
      .post('/handovers', body)
      .then(({ data }) => data)
  }
}
