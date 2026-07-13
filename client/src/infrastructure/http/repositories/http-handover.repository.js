import { httpClient } from '../client.js'

export function createHttpHandoverRepository() {
  return {
    async listHandovers() {
      const { data } = await httpClient.get('/handovers')
      return data
    },
  }
}
