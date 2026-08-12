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
  return function advanceOrderRequest(id, { notes = '', assignees, expectedVersion } = {}) {
    // Forward every field the endpoint accepts. `assignees` in particular is
    // REQUIRED on the pending → görüldü step ("Tasarımcıya Aktar"): the server
    // 400s with "Tasarımcı seçmeden talebi aktaramazsın." without it, which is
    // what an earlier `{ notes }`-only body caused on every transfer, even
    // though the team leader had picked designers in the dialog.
    //
    // `actor` is deliberately NOT forwarded — the signer is read from the
    // session server-side, and the body schema is additionalProperties:false,
    // so passing it through would 400 instead.
    const body = { notes }
    if (assignees !== undefined) body.assignees = assignees
    if (expectedVersion !== undefined) body.expectedVersion = expectedVersion
    return httpClient
      .patch(`/order-requests/${id}/advance`, body)
      .then(({ data }) => data)
  }
}
