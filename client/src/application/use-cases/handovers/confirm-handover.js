import { httpClient } from '../../../infrastructure/http/client.js'

/**
 * Sales confirms receipt of the produced materials ("Alındı"). This
 * closes the handover and moves the linked project to Satışta — the
 * only path to Satışta in the current workflow.
 */
export function makeConfirmHandover() {
  return function confirmHandover(id) {
    return httpClient
      .post(`/handovers/${id}/confirm`)
      .then(({ data }) => data)
  }
}
