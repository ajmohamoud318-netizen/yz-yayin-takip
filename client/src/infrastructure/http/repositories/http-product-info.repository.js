import { httpClient } from '../client.js'

/**
 * Product info (ürün bilgileri / parçalar) repository.
 *
 * Backs the Demo/Ozalit forms and the Ürün Bilgileri catalog. Replaces the
 * old localStorage-only store so a project's spec is shared across users and
 * browsers.
 */
export function createHttpProductInfoRepository() {
  return {
    // Every project's components, keyed rows: [{ project_id, components }]
    async listProductInfo() {
      const { data } = await httpClient.get('/product-info')
      return data
    },
    // One project's components array (empty array when it has no spec yet).
    async getProductInfo(projectId) {
      const { data } = await httpClient.get(`/product-info/${encodeURIComponent(projectId)}`)
      return data?.components ?? []
    },
    // Upsert a project's components.
    async saveProductInfo(projectId, components) {
      const { data } = await httpClient.put(
        `/product-info/${encodeURIComponent(projectId)}`,
        { components: components ?? [] },
      )
      return data
    },
  }
}
