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
  }
}
