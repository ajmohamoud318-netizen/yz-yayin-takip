import { httpClient } from '../../http/client.js'
import { ORDER_STEP_LABELS } from '../../../domain/index.js'
import { mockOrderRequests, mockUsers, saveState } from '../store.js'
import { mockOrHttp } from '../helpers/mock-handler.js'
import { notFound } from '../helpers/errors.js'

export function createMockOrderRepository(userRepo) {
  return {
    listOrderRequests() {
      return mockOrHttp(
        () => mockOrderRequests.map((r) => ({ ...r })),
        async () => {
          const { data } = await httpClient.get('/order-requests')
          return data
        },
      )
    },

    createOrderRequest({ projectId, projectTitle, items = [], quantity, notes, requester }) {
      return mockOrHttp(
        () => {
          const now = new Date().toISOString()
          const actor = requester ?? userRepo.findById('u-esra') ?? mockUsers.find((u) => u.id === 'u-esra')
          const req = {
            id: `or-${Date.now()}`,
            project_id: projectId,
            project_title: projectTitle,
            requested_by: actor?.id ?? 'u-esra',
            requested_by_name: actor?.name ?? 'Esra Kılıçkan',
            items,
            quantity,
            notes: notes ?? '',
            status: 'pending',
            created_at: now,
            updated_at: now,
            order_history: [
              {
                id: `oh-${Date.now()}-1`,
                step: 'pending',
                step_label: ORDER_STEP_LABELS.pending,
                signed_by_id: actor?.id ?? 'u-esra',
                signed_by_name: actor?.name ?? 'Esra Kılıçkan',
                signed_by_role: actor?.role ?? 'satis',
                signed_at: now,
                notes: notes ?? '',
              },
            ],
          }
          mockOrderRequests.unshift(req)
          saveState()
          return { ...req }
        },
        async () => {
          const { data } = await httpClient.post('/order-requests', {
            projectId,
            projectTitle,
            items,
            quantity,
            notes,
          })
          return data
        },
      )
    },

    updateOrderRequest(id, status) {
      return mockOrHttp(
        () => {
          const idx = mockOrderRequests.findIndex((r) => r.id === id)
          if (idx === -1) notFound('Talep bulunamadı.')
          mockOrderRequests[idx] = {
            ...mockOrderRequests[idx],
            status,
            updated_at: new Date().toISOString(),
          }
          saveState()
          return { ...mockOrderRequests[idx] }
        },
        async () => {
          const { data } = await httpClient.patch(`/order-requests/${id}`, { status })
          return data
        },
      )
    },

    /** Advance order status in mock store; returns updated order or throws. */
    advanceOrderInStore(id, { actor, notes = '' }) {
      const idx = mockOrderRequests.findIndex((r) => r.id === id)
      if (idx === -1) notFound('Talep bulunamadı.')
      const order = mockOrderRequests[idx]
      return { idx, order }
    },

    persistOrder(idx, order) {
      mockOrderRequests[idx] = order
      saveState()
      return { ...order }
    },
  }
}
