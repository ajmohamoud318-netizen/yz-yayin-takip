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
        (o) => o.project_id === projectId && o.status !== 'baskida' && o.status !== 'rejected',
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
    // Save a draft of the baski_onayi_bekleniyor print-spec form without
    // advancing — the form snapshot lives on order_requests.baski_onay_form
    // (migration 046), not the shared demos table.
    async saveOrderBaskiOnayForm(id, body) {
      const { data } = await httpClient.patch(`/order-requests/${id}/baski-onay-form`, body)
      return data
    },
    // Mark the baski_onayi_bekleniyor form "hazırlandı" (migration 060, maker
    // half): saves the sheet and hands it to another team leader. Does NOT
    // advance the order — approveOrderBaskiOnayForm does that, and refuses
    // the preparer while any other leader is active.
    async prepareOrderBaskiOnayForm(id, body) {
      const { data } = await httpClient.post(`/order-requests/${id}/baski-onay-prepare`, body)
      return data
    },
    // Approve the baski_onayi_bekleniyor form — saves the final snapshot AND
    // advances the order to onaylandi in one action.
    async approveOrderBaskiOnayForm(id, body) {
      const { data } = await httpClient.post(`/order-requests/${id}/baski-onay-approve`, body)
      return data
    },
    // Full parity with the main pipeline's demo/ozalit started/cancel/edit/
    // change-request flow (migrations 048/049), scoped to the order's own
    // ozalit round delivered at matbaa_ozalit_yapiyor — see order-transitions.js.
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

    /* ------------------------------------------------------------------ */
    /* Per-parça routing for a sipariş's ozalit round (migration 080).     */
    /*                                                                     */
    /* Twins of http-project.repository's parça calls, verb for verb. The  */
    /* six above act on the WHOLE order — they read order_requests'        */
    /* `ozalit_started`, which a split round never sets — so on exactly    */
    /* the rounds where one parça is on the press and the rest are not,    */
    /* they are unreachable. These carry the same verbs against one        */
    /* parça's own `started_at`.                                          */
    /* ------------------------------------------------------------------ */

    async listOrderParcaState(id) {
      const { data } = await httpClient.get(`/order-requests/${id}/parca-state`)
      return data
    },

    /** Matbaa: began work on this one parça of the reprint. */
    async startOrderParca(id, parca) {
      const { data } = await httpClient.post(
        `/order-requests/${id}/parca/${encodeURIComponent(parca)}/start`, {},
      )
      return data
    },

    /** Matbaa: handed this one parça back; it returns to the leader's gate. */
    async deliverOrderParca(id, parca) {
      const { data } = await httpClient.post(
        `/order-requests/${id}/parca/${encodeURIComponent(parca)}/deliver`, {},
      )
      return data
    },

    /** Leader or assigned designer: took delivery of ONE parça. */
    async receiveOrderParca(id, parca) {
      const { data } = await httpClient.post(
        `/order-requests/${id}/parca/${encodeURIComponent(parca)}/receive`, {},
      )
      return data
    },

    /**
     * Designer: revized this parça and is sending it back round. `route` is
     * 'physical' (the matbaa produces it again) or 'ekran' (screen check,
     * straight back to the leader — and on that route the designer's own
     * approval is not required, their request IS the sign-off).
     */
    async requestOrderParcaRound(id, parca, route) {
      const { data } = await httpClient.post(
        `/order-requests/${id}/parca/${encodeURIComponent(parca)}/request-round`, { route },
      )
      return data
    },

    async requestOrderParcaChange(id, parca, note) {
      const { data } = await httpClient.post(
        `/order-requests/${id}/parca/${encodeURIComponent(parca)}/change-request`, { note },
      )
      return data
    },
    async acceptOrderParcaChange(id, parca) {
      const { data } = await httpClient.post(
        `/order-requests/${id}/parca/${encodeURIComponent(parca)}/change-accept`, {},
      )
      return data
    },
    async declineOrderParcaChange(id, parca) {
      const { data } = await httpClient.post(
        `/order-requests/${id}/parca/${encodeURIComponent(parca)}/change-decline`, {},
      )
      return data
    },

    /**
     * The per-parça approval gate at imza_bekleniyor.
     *
     * `parcalar` is explicit rather than "everything pending": the grid decides
     * what this click covers (one row, or the bulk shortcut), and a server that
     * inferred it would approve parçalar that arrived between render and click.
     */
    async approveOrderParcalar(id, parcalar, notes = '') {
      const { data } = await httpClient.post(
        `/order-requests/${id}/parca-approve`, { parcalar, notes },
      )
      return data
    },

    /**
     * `target` says whose desk the parça goes to — 'designer' or 'matbaa'.
     * Required, with no default: sending it to the wrong party is a silent week
     * of nobody working on it.
     */
    async rejectOrderParcalar(id, parcalar, { reason = '', target } = {}) {
      const { data } = await httpClient.post(
        `/order-requests/${id}/parca-reject`, { parcalar, reason, target },
      )
      return data
    },
  }
}
