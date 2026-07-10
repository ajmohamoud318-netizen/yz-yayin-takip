import { httpClient } from '../../http/client.js'
import { ORDER_STEP_LABELS } from '../../../domain/index.js'
import { mockOrderRequests, mockUsers, saveState } from '../store.js'
import { mockOrHttp } from '../helpers/mock-handler.js'
import { notFound } from '../helpers/errors.js'
import { uid } from '../helpers/id.js'

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
            id: uid('or-'),
            project_id: projectId,
            project_title: projectTitle,
            requested_by: actor?.id ?? 'u-esra',
            requested_by_name: actor?.name ?? 'Esra Kılıç',
            items,
            quantity,
            notes: notes ?? '',
            status: 'pending',
            created_at: now,
            updated_at: now,
            order_history: [
              {
                id: uid('oh-'),
                step: 'pending',
                step_label: ORDER_STEP_LABELS.pending,
                signed_by_id: actor?.id ?? 'u-esra',
                signed_by_name: actor?.name ?? 'Esra Kılıç',
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

    /**
     * An order is "open" until it reaches `onaylandi` (Üretime Alındı). Used to
     * enforce one in-flight order per project — mirrors the handover pending
     * guard.
     */
    findOpenByProject(projectId) {
      return (
        mockOrderRequests.find(
          (r) => r.project_id === projectId && r.status !== 'onaylandi',
        ) ?? null
      )
    },

    /** Advance order status in mock store; returns updated order or throws. */
    advanceOrderInStore(id, { actor, notes = '', expectedVersion = null } = {}) {
      const idx = mockOrderRequests.findIndex((r) => r.id === id)
      if (idx === -1) notFound('Talep bulunamadı.')
      const order = mockOrderRequests[idx]
      // Optimistic-concurrency guard. Each call that wants to advance the
      // order passes the version it loaded; if anyone else has already
      // advanced the order, the persisted version no longer matches and we
      // throw. Stops two leaders from double-signing the same step.
      if (expectedVersion !== null && order.version !== expectedVersion) {
        const err = new Error('Bu talep başka biri tarafından güncellendi. Sayfayı yenileyin.')
        err.status = 409
        err.code = 'stale_order'
        throw err
      }
      return { idx, order }
    },

    persistOrder(idx, order) {
      const next = { ...order, version: (order.version ?? 0) + 1 }
      mockOrderRequests[idx] = next
      saveState()
      return { ...next }
    },
  }
}
