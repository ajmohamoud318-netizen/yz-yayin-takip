import { httpClient } from '../../../infrastructure/http/client.js'

/**
 * Matbaa raises a handover ("teslim") request for a project whose
 * production is finished (TR: Üretimde, ÇİN: Gümrük). One pending
 * request per project — server enforces the eligibility + duplicate
 * guard.
 */
export function makeCreateHandover() {
  return function createHandover({ projectId }) {
    return httpClient
      .post('/handovers', { projectId })
      .then(({ data }) => data)
  }
}
