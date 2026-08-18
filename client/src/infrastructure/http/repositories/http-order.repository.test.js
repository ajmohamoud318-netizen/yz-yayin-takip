/**
 * `updateOrderSubtask` PATCHes this order's own alt görevler snapshot
 * (order_subtasks — migration 039), scoped by orderId so two concurrent
 * orders on the same project never share rework-tracking state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../client.js', () => ({
  httpClient: { post: vi.fn(), patch: vi.fn(), get: vi.fn() },
}))

import { httpClient } from '../client.js'
import { createHttpOrderRepository } from './http-order.repository.js'

describe('createHttpOrderRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updateOrderSubtask PATCHes /order-requests/:orderId/subtasks/:id and returns the data', async () => {
    httpClient.patch.mockResolvedValueOnce({ data: { id: 'os-1', needs_revize: true } })
    const repo = createHttpOrderRepository()
    const result = await repo.updateOrderSubtask('or-1', 'os-1', { needs_revize: true })
    expect(httpClient.patch).toHaveBeenCalledWith('/order-requests/or-1/subtasks/os-1', {
      needs_revize: true,
    })
    expect(result).toEqual({ id: 'os-1', needs_revize: true })
  })
})
