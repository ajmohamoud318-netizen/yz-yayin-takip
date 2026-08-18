import { httpClient } from '../client.js'

export function createHttpOrderRepository() {
  return {
    async listOrderRequests() {
      const { data } = await httpClient.get('/order-requests')
      return data
    },
    async createOrderRequest(payload) {
      const { data } = await httpClient.post('/order-requests', payload)
      return data
    },
    async findOpenByProject(projectId) {
      const all = await httpClient.get('/order-requests')
      return (all.data ?? []).find(
        (o) => o.project_id === projectId && o.status !== 'onaylandi' && o.status !== 'rejected',
      ) ?? null
    },
    // Mark a delivered matbaa ozalit "Teslim Alındı" — the gate before the
    // multi-party matbaa onay. Twin of receiveOzalit on the project repo.
    async matbaaReceiveOrder(id) {
      const { data } = await httpClient.post(`/order-requests/${id}/matbaa-receive`, {})
      return data
    },
    // Report that a delivered matbaa ozalit never reached the leader/designer
    // — sends it back to tasarımcı onayı for re-delivery.
    async matbaaNotReceivedOrder(id) {
      const { data } = await httpClient.post(`/order-requests/${id}/matbaa-not-received`, {})
      return data
    },
    // Toggle one row of this order's own alt görevler snapshot (order_subtasks) —
    // see migration 039. Scoped to the order so concurrent orders on the same
    // project never share rework-tracking state.
    async updateOrderSubtask(orderId, subtaskId, patch) {
      const { data } = await httpClient.patch(`/order-requests/${orderId}/subtasks/${subtaskId}`, patch)
      return data
    },
  }
}
