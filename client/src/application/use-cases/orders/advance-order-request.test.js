/**
 * Cross-aggregate use-case test — order advance.
 *
 * After the mock-removal refactor, `makeAdvanceOrderRequest` is a thin
 * wrapper around `httpClient.patch`. We assert it sends the right URL
 * and body, and that the returned data is passed through unchanged.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../../infrastructure/http/client.js', () => ({
  httpClient: { post: vi.fn(), patch: vi.fn(), get: vi.fn() },
}))

import { httpClient } from '../../../infrastructure/http/client.js'
import { makeAdvanceOrderRequest } from './advance-order-request.js'

describe('advanceOrderRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('PATCHes /order-requests/:id/advance with the notes and returns the data', async () => {
    httpClient.patch.mockResolvedValueOnce({ data: { id: 'or-1', status: 'goruldu' } })
    const advance = makeAdvanceOrderRequest()
    const result = await advance('or-1', { notes: 'hızlıca ilerleyin' })
    expect(httpClient.patch).toHaveBeenCalledWith('/order-requests/or-1/advance', {
      notes: 'hızlıca ilerleyin',
    })
    expect(result).toEqual({ id: 'or-1', status: 'goruldu' })
  })

  it('defaults notes to an empty string when omitted', async () => {
    httpClient.patch.mockResolvedValueOnce({ data: { id: 'or-2', status: 'goruldu' } })
    const advance = makeAdvanceOrderRequest()
    await advance('or-2', {})
    expect(httpClient.patch).toHaveBeenCalledWith('/order-requests/or-2/advance', { notes: '' })
  })
})
