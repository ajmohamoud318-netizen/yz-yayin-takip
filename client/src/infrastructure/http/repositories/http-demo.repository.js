import { httpClient } from '../client.js'

export function createHttpDemoRepository() {
  return {
    async listDemos() {
      const { data } = await httpClient.get('/demos')
      return data
    },
    async createDemo(payload) {
      const { data } = await httpClient.post('/demos', payload)
      return data
    },
  }
}
