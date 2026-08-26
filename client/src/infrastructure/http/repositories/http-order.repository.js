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
    // Save a draft of the siparis_baski_onay print-spec form without
    // advancing — the form snapshot lives on order_requests.baski_onay_form
    // (migration 046), not the shared demos table.
    async saveOrderBaskiOnayForm(id, body) {
      const { data } = await httpClient.patch(`/order-requests/${id}/baski-onay-form`, body)
      return data
    },
    // Approve the siparis_baski_onay form — saves the final snapshot AND
    // advances the order to onaylandi in one action.
    async approveOrderBaskiOnayForm(id, body) {
      const { data } = await httpClient.post(`/order-requests/${id}/baski-onay-approve`, body)
      return data
    },
    // Full parity with the main pipeline's demo/ozalit started/cancel/edit/
    // change-request flow (migrations 048/049), scoped to the order's own
    // ozalit round delivered at tasarimci_onay — see order-transitions.js.
    async startOrderOzalit(id) {
      const { data } = await httpClient.post(`/order-requests/${id}/ozalit-start`, {})
      return data
    },
    async cancelOrderOzalit(id) {
      const { data } = await httpClient.post(`/order-requests/${id}/ozalit-cancel`, {})
      return data
    },
    // `sheet` is { attempt, payload } — the corrected ozalit sheet, written
    // by the route inside the same transaction that authorizes the edit
    // (migration 053). Omitted by callers that only changed the reçete rows.
    async notifyOrderOzalitEdit(id, sheet = {}) {
      const { data } = await httpClient.post(`/order-requests/${id}/ozalit-edit-notify`, sheet)
      return data
    },
    async requestOrderOzalitChange(id, note) {
      const { data } = await httpClient.post(`/order-requests/${id}/ozalit-change-request`, { note })
      return data
    },
    async acceptOrderOzalitChange(id) {
      const { data } = await httpClient.post(`/order-requests/${id}/ozalit-change-accept`, {})
      return data
    },
    async declineOrderOzalitChange(id) {
      const { data } = await httpClient.post(`/order-requests/${id}/ozalit-change-decline`, {})
      return data
    },
  }
}
